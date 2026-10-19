import {
	ALL_SEGMENT_IDS,
	type ContextLineMode,
	renderSegment,
	type SegmentContext,
	type StatusLineSegmentId,
	type StatusLineSegmentOptions,
} from "@oh-my-pi/pi-tui/status-line";
import { CONTEXT_LINE_MODE_VALUES } from "@oh-my-pi/pi-tui/status-line/schema";
import type { OptionValue, WidgetItem } from "../config";
import { embeddedContextGaugeMinWidth, renderContextGauge } from "./gauge";
import type { OptionDef, RenderEnv, WidgetDef } from "./types";

const SEGMENT_INFO: Record<StatusLineSegmentId, { name: string; description: string }> = {
	pi: { name: "Pi brand", description: "omp brand mark, profile, working spinner and turn timer" },
	status: { name: "Hook status", description: "Extension/hook status texts inside the bar" },
	model: { name: "Model", description: "Model name, thinking level, fast/advisor marks" },
	mode: { name: "Mode", description: "Plan, loop, goal, prewalk and vibe mode markers" },
	path: { name: "Path", description: "Working directory (abbreviated, elastic)" },
	git: { name: "Git", description: "Branch and staged/unstaged/untracked counts" },
	pr: { name: "Pull request", description: "Open pull request number for the branch" },
	subagents: { name: "Subagents", description: "Running subagent count" },
	token_in: { name: "Tokens in", description: "Input tokens this session" },
	token_out: { name: "Tokens out", description: "Output tokens this session" },
	token_total: { name: "Tokens total", description: "Total tokens excluding cache reads" },
	token_rate: { name: "Token rate", description: "Output tokens per second" },
	cost: { name: "Cost", description: "Session spend (or subscription marker)" },
	context_pct: { name: "Context %", description: "Context window usage percent" },
	context_total: { name: "Context window", description: "Context window size" },
	time_spent: { name: "Time spent", description: "Active processing time this session" },
	time: { name: "Clock", description: "Wall clock" },
	session: { name: "Session id", description: "Short session id" },
	hostname: { name: "Hostname", description: "Short machine hostname" },
	cache_read: { name: "Cache read", description: "Cache-read tokens" },
	cache_write: { name: "Cache write", description: "Cache-write tokens" },
	cache_hit: { name: "Cache hit", description: "Cache hit ratio" },
	session_name: { name: "Session title", description: "Session title (hidden on the band composer row)" },
	usage: { name: "Usage limits", description: "Provider usage-limit windows" },
	collab: { name: "Collab", description: "Collaboration host/guest participants" },
	stream: { name: "Stream", description: "Live stream viewer count" },
	vim: { name: "Vim mode", description: "Modal editing state" },
};

const boolOption = (key: string, label: string): OptionDef => ({ key, label, kind: "bool", default: "inherit" });

const SEGMENT_OPTIONS: Partial<Record<StatusLineSegmentId, readonly OptionDef[]>> = {
	pi: [boolOption("showProfile", "Show profile")],
	model: [boolOption("showThinkingLevel", "Show thinking level")],
	path: [
		boolOption("abbreviate", "Abbreviate"),
		{ key: "maxLength", label: "Max length", kind: "number", min: 8, max: 200, default: "inherit" },
		boolOption("stripWorkPrefix", "Strip work prefix"),
	],
	git: [
		boolOption("showBranch", "Show branch"),
		boolOption("showStaged", "Show staged"),
		boolOption("showUnstaged", "Show unstaged"),
		boolOption("showUntracked", "Show untracked"),
	],
	time: [
		{ key: "format", label: "Format", kind: "enum", values: ["12h", "24h"], default: "inherit" },
		boolOption("showSeconds", "Show seconds"),
	],
};

export const CONTEXT_SEGMENTS: Readonly<Record<string, true>> = { context_pct: true, context_total: true };

/** Built-in segment options merged with this item's overrides for its segment key. */
function segmentOptionsFor(id: StatusLineSegmentId, item: WidgetItem, env: RenderEnv): StatusLineSegmentOptions {
	const base = env.builtin.segmentOptions;
	const overrides = item.options;
	if (!overrides || !(id in SEGMENT_OPTIONS)) return base;
	const current: Record<string, OptionValue> = { ...(base[id as keyof StatusLineSegmentOptions] ?? {}) };
	Object.assign(current, overrides);
	return { ...base, [id]: current };
}

function segmentContext(id: StatusLineSegmentId, item: WidgetItem, env: RenderEnv): SegmentContext {
	return {
		...env.ctx,
		options: segmentOptionsFor(id, item, env),
		compactThinkingLevel: env.builtin.compactThinkingLevel,
		sessionAccent: env.builtin.sessionAccent,
	};
}

function segmentWidget(id: StatusLineSegmentId): WidgetDef {
	const info = SEGMENT_INFO[id];
	return {
		type: id,
		name: info.name,
		description: info.description,
		category: "omp",
		kind: "content",
		options: SEGMENT_OPTIONS[id] ?? [],
		elastic: id === "path" ? "path" : id === "session_name" ? "title" : undefined,
		render(item, env) {
			if (id === "session_name" && env.surface === "band") return null;
			const rendered = renderSegment(id, segmentContext(id, item, env));
			return rendered.visible ? rendered.content : null;
		},
		reshrink:
			id === "path"
				? (item, env, maxLength) => {
						const ctx = segmentContext(id, item, env);
						const rendered = renderSegment("path", {
							...ctx,
							options: { ...ctx.options, path: { ...ctx.options.path, maxLength } },
						});
						return rendered.visible && rendered.content ? rendered.content : null;
					}
				: undefined,
	};
}

const jobsWidget: WidgetDef = {
	type: "jobs",
	name: "Background jobs",
	description: "Running background bash/eval/task jobs (the built-in jobs badge)",
	category: "environment",
	kind: "content",
	options: [],
	render(_item, env) {
		const count = env.component.runningBackgroundJobCount();
		return count > 0 ? env.theme.fg("statusLineSubagents", `${env.theme.icon.job} ${count}`) : null;
	},
};

function gaugeMode(item: WidgetItem, env: RenderEnv): ContextLineMode {
	const mode = item.options?.mode;
	return CONTEXT_LINE_MODE_VALUES.find(value => value === mode) ?? env.builtin.contextLine;
}

/** Whether the gauge draws on this surface (`framed` keeps plain rows as air). */
function gaugeDraws(item: WidgetItem, env: RenderEnv): boolean {
	return env.surface !== "free" || item.options?.surfaces === "always";
}

export const contextGaugeWidget: WidgetDef = {
	type: "context_gauge",
	name: "Context gauge",
	description: "The built-in context-reactive rule between groups (flexible width)",
	category: "context",
	kind: "flex",
	options: [
		{
			key: "mode",
			label: "Mode",
			kind: "enum",
			values: CONTEXT_LINE_MODE_VALUES,
			default: "inherit",
		},
		{ key: "surfaces", label: "Draw on", kind: "enum", values: ["framed", "always"], default: "framed" },
	],
	render: () => "",
	renderFlex(item, env, width) {
		if (!gaugeDraws(item, env)) return " ".repeat(width);
		const mode = gaugeMode(item, env);
		const embed = env.embedContext === true && mode === "embedded";
		return renderContextGauge(width, env.ctx, mode, embed, env.builtin.sessionAccent);
	},
	minFlexWidth(item, env) {
		if (!gaugeDraws(item, env) || env.embedContext !== true || gaugeMode(item, env) !== "embedded") return 1;
		return embeddedContextGaugeMinWidth(env.ctx.contextPercent, env.ctx.contextWindow);
	},
};

/** Whether a gauge item on this line resolves to the embedded mode. */
export function embedsContext(item: WidgetItem, env: RenderEnv): boolean {
	return item.type === "context_gauge" && env.surface !== "free" && gaugeMode(item, env) === "embedded";
}

export const BUILTIN_WIDGETS: readonly WidgetDef[] = [
	...ALL_SEGMENT_IDS.map(segmentWidget),
	jobsWidget,
	contextGaugeWidget,
];
