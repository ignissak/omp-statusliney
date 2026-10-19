import { settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgComposerShape } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { type ComposerStyle, truncateToWidth } from "@oh-my-pi/pi-tui";
import { sanitizeHookStatusText } from "@oh-my-pi/pi-tui/chrome/shared";
import { getComposerStyle } from "@oh-my-pi/pi-tui/components/composer/registry";
import {
	getPreset,
	getSeparator,
	SEGMENTS,
	type StatusLineComponent,
	type StatusLineSegmentId,
	type StatusLineSegmentOptions,
} from "@oh-my-pi/pi-tui/status-line";
import { theme } from "@oh-my-pi/pi-tui/theme";
import type { StatuslineyConfig, WidgetItem } from "./config";
import { type LayoutPart, type LayoutStyle, layoutLine } from "./layout";
import type { ConfigStore } from "./store";
import {
	captureContext,
	type Renderer,
	realStatusLineSettings,
	type SlotSurface,
	takeoverState,
} from "./takeover";
import { CONTEXT_SEGMENTS, embedsContext } from "./widgets/builtin";
import { GIT_EXTRA_TYPES } from "./widgets/git";
import { getWidget } from "./widgets/registry";
import type { BuiltinPrefs, PluginData, RenderEnv, Surface, WidgetDef } from "./widgets/types";

const TRANSPARENT_BG = "\x1b[49m";

type Attachment = ComposerStyle["statusAttachment"];

export interface FrameRenderer extends Renderer {
	/** Lines for the above-editor widget. */
	aboveLines(width: number): string[];
	/** Every line on the surface it really uses, for the settings preview. */
	previewLines(width: number): string[];
	requestRender(): void;
}

function isSegmentId(type: string): type is StatusLineSegmentId {
	return Object.hasOwn(SEGMENTS, type);
}

/** Replicates the built-in `#computeEffectiveSettings` for the display prefs widgets honour. */
export function builtinPrefs(inst: StatusLineComponent | undefined): BuiltinPrefs {
	const user = (inst && takeoverState().userSettings.get(inst)) ?? realStatusLineSettings();
	const preset = user.preset ?? "default";
	const presetDef = getPreset(preset);
	const segmentOptions: Record<string, Record<string, unknown>> = {};
	for (const [segment, options] of Object.entries(presetDef.segmentOptions ?? {})) {
		segmentOptions[segment] = { ...options };
	}
	for (const [segment, options] of Object.entries(user.segmentOptions ?? {})) {
		segmentOptions[segment] = { ...segmentOptions[segment], ...options };
	}
	return {
		preset,
		separator: user.separator ?? presetDef.separator,
		transparent: user.transparent === true,
		sessionAccent: user.sessionAccent !== false,
		compactThinkingLevel: user.compactThinkingLevel ?? false,
		contextLine: user.contextLine ?? "embedded",
		showHookStatus: user.showHookStatus ?? true,
		segmentOptions: segmentOptions as StatusLineSegmentOptions, // per-segment records built from typed sources
	};
}

function lineStyle(config: StatuslineyConfig, builtin: BuiltinPrefs, surface: Surface): LayoutStyle {
	let bg: string;
	if (config.background === "on") bg = theme.getBgAnsi("statusLineBg");
	else if (config.background === "off") bg = TRANSPARENT_BG;
	else bg = surface !== "free" && !builtin.transparent ? theme.getBgAnsi("statusLineBg") : TRANSPARENT_BG;
	const def = getSeparator(config.separator === "inherit" ? builtin.separator : config.separator, theme);
	const caps = def.endCaps && bg !== TRANSPARENT_BG ? def.endCaps : undefined;
	return {
		bg,
		fg: theme.getFgAnsi("text"),
		sep: theme.getFgAnsi("statusLineSep"),
		sepLeft: def.left,
		sepRight: def.right,
		caps,
		bandCap: surface === "band" && caps ? theme.sep.powerlineCapLeft : undefined,
	};
}

function styleContent(item: WidgetItem, raw: string): string {
	let text = item.color ? theme.fg(item.color, Bun.stripANSI(raw)) : raw;
	if (item.bold) text = theme.bold(text);
	if (item.label) text = (item.color ? theme.fg(item.color, item.label) : item.label) + text;
	return text;
}

interface Entry {
	item: WidgetItem;
	def: WidgetDef;
	text?: string;
}

/** Render one config line on `surface`; "" when nothing is visible. */
export function renderLine(items: readonly WidgetItem[], env: RenderEnv, config: StatuslineyConfig): string {
	const entries: Entry[] = [];
	for (const item of items) {
		const def = getWidget(item.type);
		if (!def) continue;
		if (def.kind === "flex") {
			entries.push({ item, def });
			continue;
		}
		const raw = def.render(item, env);
		if (!raw) continue;
		entries.push({ item, def, text: def.kind === "content" ? styleContent(item, raw) : raw });
	}

	let lineEnv = env;
	if (env.ctx.contextWindow > 0 && items.some(item => embedsContext(item, env))) {
		const content = entries.filter(entry => entry.def.kind === "content");
		const hasContext = content.some(entry => CONTEXT_SEGMENTS[entry.item.type]);
		const hasOther = content.some(entry => !CONTEXT_SEGMENTS[entry.item.type]);
		if (hasContext && hasOther) {
			lineEnv = { ...env, embedContext: true };
			for (let i = entries.length - 1; i >= 0; i--) {
				if (entries[i].def.kind === "content" && CONTEXT_SEGMENTS[entries[i].item.type]) entries.splice(i, 1);
			}
		}
	}

	const parts: LayoutPart[] = entries.map(({ item, def, text }) => {
		if (def.kind === "flex") {
			return {
				id: item.id,
				type: item.type,
				kind: "flex",
				text: "",
				fill: width => def.renderFlex?.(item, lineEnv, width) ?? " ".repeat(width),
				minWidth: def.minFlexWidth?.(item, lineEnv),
			};
		}
		const reshrink = def.reshrink;
		return {
			id: item.id,
			type: item.type,
			kind: def.kind,
			text: text ?? "",
			elastic: def.elastic,
			reshrink: reshrink
				? maxLength => {
						const raw = reshrink(item, lineEnv, maxLength);
						return raw ? styleContent(item, raw) : null;
					}
				: undefined,
		};
	});
	if (!parts.some(part => part.kind !== "flex")) return "";
	return layoutLine(parts, env.width, lineStyle(config, env.builtin, env.surface));
}

function slotFor(attachment: Attachment): SlotSurface | undefined {
	if (attachment === "top-band") return "band";
	if (attachment === "top-border") return "box";
	return undefined;
}

export function createFrameRenderer(store: ConfigStore, data: PluginData): FrameRenderer {
	const state = takeoverState();
	let memo: { inst: StatusLineComponent; lines: Map<string, string[]> } | undefined;

	const requestRender = (): void => {
		state.tui?.requestRender();
	};

	const attachmentOf = (inst: StatusLineComponent): Attachment =>
		state.styles.get(inst)?.statusAttachment ?? getComposerStyle(cfgComposerShape.get(settings)).statusAttachment;

	const placementOf = (attachment: Attachment): { mode: "top" | "bottom"; slot?: SlotSurface } => {
		const slot = slotFor(attachment);
		const placement = store.get().placement;
		const mode = placement === "auto" ? (slot ? "top" : "bottom") : placement;
		return { mode, slot };
	};

	/** Every config line rendered on `surface` ("" for hidden lines), memoized for this frame. */
	const renderAll = (inst: StatusLineComponent, surface: Surface, width: number, preview: boolean): string[] => {
		if (memo?.inst !== inst) {
			memo = { inst, lines: new Map() };
			const current = memo;
			queueMicrotask(() => {
				if (memo === current) memo = undefined;
			});
		}
		const key = `${surface}|${width}|${preview}`;
		const cached = memo.lines.get(key);
		if (cached) return cached;
		const ctx = captureContext(inst);
		let lines: string[] = [];
		if (ctx) {
			const config = store.get();
			const env: RenderEnv = {
				ctx,
				component: inst,
				theme,
				width,
				surface,
				builtin: builtinPrefs(inst),
				data,
				preview,
				requestRender,
			};
			lines = config.lines.map(items => renderLine(items, env, config));
		}
		memo.lines.set(key, lines);
		return lines;
	};

	const nonEmpty = (lines: readonly string[]): string[] => lines.filter(line => line !== "");

	const preview = (
		inst: StatusLineComponent,
		width: number,
		style: Pick<ComposerStyle, "statusAttachment"> | undefined,
		isPreview: boolean,
	): string[] => {
		const { mode, slot } = placementOf(style?.statusAttachment ?? attachmentOf(inst));
		return nonEmpty(renderAll(inst, mode === "top" && slot ? slot : "free", width, isPreview));
	};

	return {
		requestRender,

		requiredSegments() {
			const required: StatusLineSegmentId[] = ["session"];
			let needsGit = false;
			for (const line of store.get().lines) {
				for (const item of line) {
					if (GIT_EXTRA_TYPES[item.type]) needsGit = true;
					if (isSegmentId(item.type) && !required.includes(item.type)) required.push(item.type);
				}
			}
			if (needsGit && !required.includes("git")) required.push("git");
			return required;
		},

		slot(inst, surface, width) {
			const { mode, slot } = placementOf(attachmentOf(inst));
			if (mode !== "top" || slot !== surface) return "";
			const lines = renderAll(inst, surface, width, false);
			return lines[lines.length - 1] ?? "";
		},

		bottom(inst, width) {
			const out: string[] = [];
			const { mode } = placementOf(attachmentOf(inst));
			if (mode === "bottom" && !state.autocomplete.get(inst)?.()) {
				const lines = nonEmpty(renderAll(inst, "free", width, false));
				if (lines.length > 0) {
					if (state.styles.get(inst)?.bottomBarGap) out.push("");
					out.push(...lines);
				}
			}
			const rows = store.get().hookStatusRows;
			const showHooks = rows === "inherit" ? builtinPrefs(inst).showHookStatus : rows === "on";
			if (showHooks) {
				const ctx = captureContext(inst);
				for (const text of ctx?.hookStatuses ?? []) out.push(truncateToWidth(sanitizeHookStatusText(text), width));
			}
			return out;
		},

		aboveLines(width) {
			const inst = state.lastInstance;
			if (!inst) return [];
			const { mode, slot } = placementOf(attachmentOf(inst));
			if (mode !== "top") return [];
			if (!slot) return nonEmpty(renderAll(inst, "free", width, false));
			return nonEmpty(renderAll(inst, slot, width, false).slice(0, -1));
		},

		previewForStyle(inst, width, style) {
			return preview(inst, width, style, false);
		},

		previewLines(width) {
			const inst = state.lastInstance;
			return inst ? preview(inst, width, undefined, true) : [];
		},
	};
}
