import {
	getPreset,
	STATUS_LINE_PRESETS,
	type StatusLinePreset,
	type StatusLineSegmentId,
} from "@oh-my-pi/pi-tui/status-line";
import type { WidgetItem } from "./config";
import { realStatusLineSettings } from "./takeover";

function items(types: readonly string[]): WidgetItem[] {
	return types.map(type => ({ id: crypto.randomUUID(), type }));
}

/**
 * One line mirroring the built-in bar: left segments, the context gauge, the
 * subagent and jobs badges that lead the right group, then the right segments.
 */
export function builtinPresetLines(
	left: readonly StatusLineSegmentId[],
	right: readonly StatusLineSegmentId[],
): WidgetItem[][] {
	return [
		items([
			...left.filter(id => id !== "subagents"),
			"context_gauge",
			"subagents",
			"jobs",
			...right.filter(id => id !== "subagents"),
		]),
	];
}

/** Lines matching the user's current built-in statusline settings. */
export function mirrorBuiltinLines(): WidgetItem[][] {
	const settings = realStatusLineSettings();
	const preset = settings.preset ?? "default";
	const def = getPreset(preset);
	if (preset === "custom") {
		return builtinPresetLines(settings.leftSegments ?? def.leftSegments, settings.rightSegments ?? def.rightSegments);
	}
	return builtinPresetLines(def.leftSegments, def.rightSegments);
}

export interface NamedPreset {
	id: string;
	label: string;
	lines: () => WidgetItem[][];
}

const BUILTIN_PRESET_NAMES: readonly Exclude<StatusLinePreset, "custom">[] = [
	"default",
	"minimal",
	"compact",
	"full",
	"nerd",
	"ascii",
];

export const NAMED_PRESETS: readonly NamedPreset[] = [
	{ id: "builtin:current", label: "Built-in: current", lines: mirrorBuiltinLines },
	...BUILTIN_PRESET_NAMES.map(name => ({
		id: `builtin:${name}`,
		label: `Built-in: ${name}`,
		lines: () => builtinPresetLines(STATUS_LINE_PRESETS[name].leftSegments, STATUS_LINE_PRESETS[name].rightSegments),
	})),
	{
		id: "two-line-dev",
		label: "Two-line dev",
		lines: () => [
			items([
				"pi",
				"vim",
				"model",
				"mode",
				"path",
				"git",
				"git_ahead_behind",
				"git_changes",
				"pr",
				"flex",
				"subagents",
				"jobs",
				"session_name",
			]),
			items([
				"context_bar",
				"token_in",
				"token_out",
				"cache_hit",
				"cost",
				"cost_rate",
				"flex",
				"tool",
				"time_spent",
				"time",
			]),
		],
	},
	{
		id: "focused",
		label: "Focused",
		lines: () => [items(["vim", "model", "thinking", "path", "git", "git_clean", "flex", "context_bar", "cost"])],
	},
];
