import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";

export interface LayoutPart {
	id: string;
	type: string;
	kind: "content" | "flex" | "separator";
	text: string;
	elastic?: "path" | "title";
	/** Flex parts: exact-width fill. */
	fill?: (width: number) => string;
	/** Flex parts: minimum width (default 1 between two groups, 0 at an edge). */
	minWidth?: number;
	/** Path parts: re-render within a smaller length budget. */
	reshrink?: (maxLength: number) => string | null;
}

export interface LayoutStyle {
	bg: string;
	fg: string;
	sep: string;
	sepLeft: string;
	sepRight: string;
	caps?: { left: string; right: string; useBgAsFg: boolean };
	bandCap?: string;
}

const RESET = "\x1b[0m";
const MIN_ELASTIC_WIDTH = 8;

interface Group {
	parts: LayoutPart[];
	/** Flex part directly before this group, if any. */
	flexBefore?: LayoutPart;
}

/** Split the line into content groups divided by flex parts. */
function splitGroups(parts: readonly LayoutPart[]): { groups: Group[]; flexes: LayoutPart[] } {
	const groups: Group[] = [];
	const flexes: LayoutPart[] = [];
	let current: Group | undefined;
	let pendingFlex: LayoutPart | undefined;
	for (const part of parts) {
		if (part.kind === "flex") {
			flexes.push(part);
			current = undefined;
			pendingFlex = part;
			continue;
		}
		if (!current) {
			current = { parts: [], flexBefore: pendingFlex };
			pendingFlex = undefined;
			groups.push(current);
		}
		current.parts.push(part);
	}
	return { groups, flexes };
}

type Side = "left" | "middle" | "right";

function groupSide(groups: readonly Group[], index: number): Side {
	if (groups.length > 1 && index === groups.length - 1) return "right";
	if (index === 0 && !groups[0].flexBefore) return "left";
	if (groups.length === 1) return "right";
	return "middle";
}

class LineLayout {
	readonly sepLeftWidth: number;
	readonly sepRightWidth: number;
	readonly capLeftWidth: number;
	readonly capRightWidth: number;
	readonly bandCapWidth: number;
	parts: LayoutPart[];

	constructor(
		parts: readonly LayoutPart[],
		readonly width: number,
		readonly style: LayoutStyle,
	) {
		this.parts = [...parts];
		this.sepLeftWidth = visibleWidth(style.sepLeft);
		this.sepRightWidth = visibleWidth(style.sepRight);
		this.capLeftWidth = style.caps ? visibleWidth(style.caps.left) : 0;
		this.capRightWidth = style.caps ? visibleWidth(style.caps.right) : 0;
		this.bandCapWidth = style.caps && style.bandCap ? visibleWidth(style.bandCap) : 0;
	}

	groups(): Group[] {
		return splitGroups(this.parts).groups;
	}

	joinerWidth(a: LayoutPart, b: LayoutPart, side: Side): number {
		if (a.kind === "separator" || b.kind === "separator") return 1;
		return (side === "right" ? this.sepRightWidth : this.sepLeftWidth) + 2;
	}

	groupWidth(groups: readonly Group[], index: number): number {
		const group = groups[index];
		if (group.parts.length === 0) return 0;
		const side = groupSide(groups, index);
		let width = 2;
		for (let i = 0; i < group.parts.length; i++) {
			width += visibleWidth(group.parts[i].text);
			if (i > 0) width += this.joinerWidth(group.parts[i - 1], group.parts[i], side);
		}
		if (side === "left" || side === "middle") width += this.capRightWidth;
		if (side === "right" || side === "middle") width += this.capLeftWidth;
		if (index === 0 && side === "left") width += this.bandCapWidth;
		return width;
	}

	/** Minimum widths of every flex part in the current line. */
	flexMinimums(): Map<LayoutPart, number> {
		const minimums = new Map<LayoutPart, number>();
		for (let i = 0; i < this.parts.length; i++) {
			const part = this.parts[i];
			if (part.kind !== "flex") continue;
			const hasBefore = this.parts.slice(0, i).some(p => p.kind !== "flex");
			const hasAfter = this.parts.slice(i + 1).some(p => p.kind !== "flex");
			minimums.set(part, part.minWidth ?? (hasBefore && hasAfter ? 1 : 0));
		}
		return minimums;
	}

	totalWidth(): number {
		const groups = this.groups();
		let total = 0;
		for (let i = 0; i < groups.length; i++) total += this.groupWidth(groups, i);
		for (const min of this.flexMinimums().values()) total += min;
		return total;
	}

	overflow(): number {
		return this.totalWidth() - this.width;
	}

	replace(part: LayoutPart, text: string): void {
		const index = this.parts.indexOf(part);
		if (index >= 0) this.parts[index] = { ...part, text };
	}

	remove(part: LayoutPart): void {
		this.parts = this.parts.filter(candidate => candidate !== part);
	}

	/** Remove a group's leftover separators and its leading flex once it has no content. */
	pruneGroup(group: Group): void {
		if (group.parts.some(part => part.kind === "content")) return;
		const doomed = new Set<LayoutPart>(group.parts);
		if (group.flexBefore) doomed.add(group.flexBefore);
		this.parts = this.parts.filter(part => !doomed.has(part));
	}

	shrinkElastic(kind: "title"): void {
		const part = this.parts.find(candidate => candidate.elastic === kind && candidate.kind === "content");
		if (!part || this.overflow() <= 0) return;
		const current = visibleWidth(part.text);
		const shrinkBy = Math.min(Math.max(0, current - MIN_ELASTIC_WIDTH), this.overflow());
		if (shrinkBy > 0) this.replace(part, truncateToWidth(part.text, current - shrinkBy));
	}

	shrinkPath(): void {
		const part = this.parts.find(candidate => candidate.elastic === "path" && candidate.kind === "content");
		if (!part?.reshrink || this.overflow() <= 0) return;
		const current = visibleWidth(part.text);
		const shrinkable = current - MIN_ELASTIC_WIDTH;
		if (shrinkable <= 0) return;
		const shrinkBy = Math.min(shrinkable, this.overflow());
		let maxLength = Math.max(4, current - shrinkBy);
		let rendered = part.reshrink(maxLength);
		if (!rendered) return;
		let width = visibleWidth(rendered);
		// maxLength governs the path text, not its icon prefix; iterate to compensate.
		for (let i = 0; i < 8; i++) {
			const saved = current - width;
			if (saved >= shrinkBy) break;
			const next = Math.max(4, maxLength - (shrinkBy - saved));
			if (next >= maxLength) break;
			maxLength = next;
			const adjusted = part.reshrink(maxLength);
			if (!adjusted) break;
			rendered = adjusted;
			width = visibleWidth(adjusted);
		}
		this.replace(part, rendered);
	}

	/** Drop parts from the end of the last group, moving inward; never touches group 0. */
	dropOuterGroups(): void {
		while (this.overflow() > 0) {
			const groups = this.groups();
			if (groups.length <= 1) return;
			const group = groups[groups.length - 1];
			const victim = group.parts[group.parts.length - 1];
			this.remove(victim);
			group.parts.pop();
			this.pruneGroup(group);
		}
	}

	/** Drop parts from the end of group 0, keeping the path part longest. */
	dropFirstGroup(): void {
		while (this.overflow() > 0) {
			const group = this.groups()[0];
			if (!group || group.parts.length === 0) return;
			let victim = group.parts[group.parts.length - 1];
			for (let i = group.parts.length - 1; i >= 0; i--) {
				if (group.parts[i].elastic !== "path") {
					victim = group.parts[i];
					break;
				}
			}
			this.remove(victim);
			group.parts.splice(group.parts.indexOf(victim), 1);
			this.pruneGroup(group);
		}
	}

	renderGroup(groups: readonly Group[], index: number): string {
		const group = groups[index];
		const { bg, fg, sep, caps } = this.style;
		const side = groupSide(groups, index);
		const glyph = side === "right" ? this.style.sepRight : this.style.sepLeft;
		let content = `${bg}${fg} `;
		for (let i = 0; i < group.parts.length; i++) {
			const part = group.parts[i];
			if (i > 0) {
				const prev = group.parts[i - 1];
				content += prev.kind === "separator" || part.kind === "separator" ? " " : ` ${sep}${glyph}${fg} `;
			}
			content += part.text;
			if (part.kind === "separator") content += fg;
		}
		content += ` ${RESET}`;
		if (!caps) return content;
		const capPrefix = caps.useBgAsFg ? bg.replace("\x1b[48;", "\x1b[38;") : bg + sep;
		const cap = (glyphText: string) => `${capPrefix}${glyphText}${RESET}`;
		let out = "";
		if (index === 0 && side === "left" && this.style.bandCap) out += cap(this.style.bandCap);
		if (side === "right" || side === "middle") out += cap(caps.left);
		out += content;
		if (side === "left" || side === "middle") out += cap(caps.right);
		return out;
	}

	render(): string {
		if (this.width > 0 && this.overflow() > 0) {
			this.shrinkElastic("title");
			this.dropOuterGroups();
			this.shrinkPath();
			this.dropFirstGroup();
		}
		const groups = this.groups();
		if (groups.length === 0 && !this.parts.some(part => part.kind === "flex")) return "";
		const minimums = this.flexMinimums();
		const flexParts = [...minimums.keys()];
		let fixed = 0;
		for (let i = 0; i < groups.length; i++) fixed += this.groupWidth(groups, i);
		const remaining = Math.max(0, this.width - fixed);
		const fillWidths = new Map<LayoutPart, number>();
		if (flexParts.length > 0) {
			const base = Math.floor(remaining / flexParts.length);
			let extra = remaining - base * flexParts.length;
			for (const part of flexParts) {
				let width = base + (extra > 0 ? 1 : 0);
				if (extra > 0) extra--;
				width = Math.max(width, minimums.get(part) ?? 0);
				fillWidths.set(part, width);
			}
		}
		let out = "";
		let groupIndex = 0;
		let inGroup = false;
		for (const part of this.parts) {
			if (part.kind === "flex") {
				inGroup = false;
				const width = fillWidths.get(part) ?? 0;
				if (width > 0) out += part.fill ? part.fill(width) : " ".repeat(width);
				continue;
			}
			if (!inGroup) {
				out += this.renderGroup(groups, groupIndex);
				groupIndex++;
				inGroup = true;
			}
		}
		return this.width > 0 && visibleWidth(out) > this.width ? truncateToWidth(out, this.width) : out;
	}
}

/** Lay out one statusline row: groups, separators, flex fills, and overflow handling. */
export function layoutLine(parts: LayoutPart[], width: number, style: LayoutStyle): string {
	return new LineLayout(parts, width, style).render();
}
