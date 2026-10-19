import { settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { type StatusLineHostSession, statusLineHost } from "@oh-my-pi/pi-coding-agent/modes/status-line-host";
import type { ContextLineMode, SegmentContext } from "@oh-my-pi/pi-tui/status-line";
import type { CompactionBoundaries } from "@oh-my-pi/pi-tui/status-line/context-usage";
import { getSessionAccentAnsi, getSessionAccentHex, theme } from "@oh-my-pi/pi-tui/theme";
import { adjustHsv, formatNumber } from "@oh-my-pi/pi-utils";

export function formatEmbeddedContextPercent(percent: number): string {
	return `${percent > 0 && percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** Gap width the embedded gauge needs for its labels; an unknown percent (`null`) shows the window label alone. */
export function embeddedContextGaugeMinWidth(percent: number | null, contextWindow: number): number {
	const percentWidth = percent === null ? 0 : formatEmbeddedContextPercent(percent).length + 2;
	return percentWidth + formatNumber(contextWindow).length + 2;
}

let boundariesMemo:
	| { contextWindow: number; modelRef: unknown; revision: number; boundaries: CompactionBoundaries | null }
	| undefined;
let dimmedAccentMemo: { sourceHex: string; hex: string } | undefined;

function compactionBoundaries(ctx: SegmentContext): CompactionBoundaries | null {
	const session = ctx.session;
	const model = session.state?.model ?? session.model;
	const revision = settings.revision;
	const memo = boundariesMemo;
	if (memo && memo.contextWindow === ctx.contextWindow && memo.modelRef === model && memo.revision === revision) {
		return memo.boundaries;
	}
	let boundaries: CompactionBoundaries | null;
	try {
		// The live statusline session is the host's AgentSession, a structural superset of StatusLineHostSession.
		boundaries = statusLineHost.computeCompactionBoundaries(session as StatusLineHostSession, ctx.contextWindow, model);
	} catch {
		boundaries = null;
	}
	boundariesMemo = { contextWindow: ctx.contextWindow, modelRef: model, revision, boundaries };
	return boundaries;
}

/**
 * The context-reactive gauge line, ported from the built-in statusline's
 * `#buildContextGaugeFill`: `off` draws a solid accent rule, `percentage` the
 * used share, `annotated` adds compaction markers, `embedded` adds the
 * percent/window labels when `embed` is set.
 */
export function renderContextGauge(
	gapWidth: number,
	ctx: SegmentContext,
	mode: ContextLineMode,
	embed: boolean,
	sessionAccent: boolean,
): string {
	const sessionName = sessionAccent ? ctx.session.sessionManager?.getSessionName() : undefined;
	const accentHex = sessionName ? getSessionAccentHex(sessionName, theme.sessionAccentInputs) : undefined;
	const usedColor = getSessionAccentAnsi(accentHex) ?? theme.getFgAnsi("borderAccent");
	const horizontal = theme.boxRound.horizontal;
	const pct = ctx.contextPercent;
	if (mode === "off" || (pct === null && ctx.contextWindow <= 0)) {
		return `\x1b[49m${usedColor}${horizontal.repeat(gapWidth)}\x1b[39m`;
	}

	const clampedPct = pct === null ? 0 : Math.min(100, Math.max(0, pct));
	let percentLabel = "";
	let windowLabel = "";
	let percentStart = -1;
	let windowStart = -1;
	let scaleWidth = gapWidth;
	const percentOverflow = pct !== null && pct > 100;
	if (embed) {
		const candidatePercent = pct === null ? "" : formatEmbeddedContextPercent(percentOverflow ? pct : clampedPct);
		const candidateWindow = formatNumber(ctx.contextWindow);
		if (gapWidth >= embeddedContextGaugeMinWidth(pct, ctx.contextWindow)) {
			percentLabel = candidatePercent;
			windowLabel = candidateWindow;
			if (percentOverflow) {
				percentStart = gapWidth - percentLabel.length;
				windowStart = percentStart - 1 - windowLabel.length;
			} else {
				windowStart = gapWidth - windowLabel.length - 1;
			}
			scaleWidth = windowStart;
		}
	}

	const usedCount = Math.min(scaleWidth, Math.max(1, Math.round((clampedPct / 100) * scaleWidth)));
	const unusedColor = theme.getFgAnsi("border");

	let speculationIdx = -1;
	let thresholdIdx = -1;
	if ((mode === "annotated" || mode === "embedded") && ctx.autoCompactEnabled && gapWidth >= 8) {
		const boundaries = compactionBoundaries(ctx);
		if (boundaries) {
			const cellFor = (percent: number) =>
				Math.min(scaleWidth - 1, Math.max(0, Math.round((percent / 100) * scaleWidth)));
			thresholdIdx = cellFor(boundaries.thresholdPercent);
			if (boundaries.speculationPercent !== null) speculationIdx = cellFor(boundaries.speculationPercent);
			if (speculationIdx === thresholdIdx) speculationIdx = -1;
		}
	}

	if (percentLabel && percentStart < 0) {
		const maxStart = scaleWidth - percentLabel.length - 1;
		const preferredStart = Math.min(maxStart, Math.max(1, usedCount));
		const overlapsBoundary = (start: number): boolean => {
			const end = start + percentLabel.length;
			return (speculationIdx >= start && speculationIdx < end) || (thresholdIdx >= start && thresholdIdx < end);
		};
		for (let distance = 0; distance <= maxStart; distance++) {
			const left = preferredStart - distance;
			if (left >= 1 && !overlapsBoundary(left)) {
				percentStart = left;
				break;
			}
			if (distance === 0) continue;
			const right = preferredStart + distance;
			if (right <= maxStart && !overlapsBoundary(right)) {
				percentStart = right;
				break;
			}
		}
	}

	const speculationGlyph = theme.symbol("context.speculation");
	const thresholdGlyph = theme.symbol("context.compaction");
	const speculationColor = theme.getFgAnsi("muted");
	const overflowColor = theme.getFgAnsi("error");
	const rawAccentHex = accentHex ?? theme.getColorHex("borderAccent");
	let dimmedAccent = dimmedAccentMemo;
	if (dimmedAccent?.sourceHex !== rawAccentHex) {
		dimmedAccent = { sourceHex: rawAccentHex, hex: adjustHsv(rawAccentHex, { s: 0.7, v: 0.75 }) };
		dimmedAccentMemo = dimmedAccent;
	}
	const thresholdColor = getSessionAccentAnsi(dimmedAccent.hex) ?? usedColor;

	const percentEnd = percentStart >= 0 ? percentStart + percentLabel.length : -1;
	const windowEnd = windowStart >= 0 ? windowStart + windowLabel.length : -1;
	let out = "\x1b[49m";
	let activeColor = "";
	let i = 0;
	while (i < gapWidth) {
		let color: string;
		let text: string;
		if (i >= percentStart && i < percentEnd) {
			const end = Math.min(percentEnd, gapWidth);
			color = percentOverflow ? overflowColor : usedColor;
			text = percentLabel.slice(i - percentStart, end - percentStart);
			i = end;
		} else if (i === thresholdIdx) {
			color = thresholdColor;
			text = thresholdGlyph;
			i++;
		} else if (i === speculationIdx) {
			color = speculationColor;
			text = speculationGlyph;
			i++;
		} else {
			const inWindow = i >= windowStart && i < windowEnd;
			let end = Math.min(inWindow ? windowEnd : i < usedCount ? usedCount : gapWidth, gapWidth);
			if (percentStart > i && percentStart < end) end = percentStart;
			if (thresholdIdx > i && thresholdIdx < end) end = thresholdIdx;
			if (speculationIdx > i && speculationIdx < end) end = speculationIdx;
			if (!inWindow && windowStart > i && windowStart < end) end = windowStart;
			if (inWindow) {
				color = thresholdColor;
				text = windowLabel.slice(i - windowStart, end - windowStart);
			} else {
				color = i < usedCount ? usedColor : unusedColor;
				text = horizontal.repeat(end - i);
			}
			i = end;
		}
		if (color !== activeColor) {
			out += color;
			activeColor = color;
		}
		out += text;
	}
	return `${out}\x1b[39m`;
}
