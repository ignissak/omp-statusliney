import type { ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { BUILTIN_WIDGETS } from "./builtin";
import { CUSTOM_WIDGETS, LAYOUT_WIDGETS } from "./custom";
import { CONTEXT_WIDGETS, ENV_WIDGETS } from "./env";
import { GIT_WIDGETS } from "./git";
import { SESSION_WIDGETS } from "./session";
import type { WidgetCategory, WidgetDef } from "./types";

export const WIDGET_COLOR_TOKENS: readonly ThemeColor[] = [
	"accent",
	"text",
	"muted",
	"dim",
	"success",
	"warning",
	"error",
	"borderAccent",
	"customMessageLabel",
	"toolTitle",
	"mdLink",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingMax",
	"statusLineModel",
	"statusLinePath",
	"statusLineGitClean",
	"statusLineGitDirty",
	"statusLineContext",
	"statusLineSpend",
	"statusLineStaged",
	"statusLineDirty",
	"statusLineUntracked",
	"statusLineOutput",
	"statusLineCost",
	"statusLineSubagents",
	"statusLineSep",
];

export const CATEGORY_NAMES: Record<WidgetCategory, string> = {
	omp: "omp built-in",
	git: "Git",
	context: "Context",
	session: "Session",
	environment: "Environment",
	custom: "Custom",
	layout: "Layout",
};

const CATEGORY_ORDER: readonly WidgetCategory[] = ["omp", "git", "context", "session", "environment", "custom", "layout"];

const ALL: readonly WidgetDef[] = [
	...BUILTIN_WIDGETS,
	...GIT_WIDGETS,
	...CONTEXT_WIDGETS,
	...SESSION_WIDGETS,
	...ENV_WIDGETS,
	...CUSTOM_WIDGETS,
	...LAYOUT_WIDGETS,
];

const BY_TYPE: Record<string, WidgetDef> = Object.fromEntries(ALL.map(def => [def.type, def]));

const ORDERED: readonly WidgetDef[] = CATEGORY_ORDER.flatMap(category => ALL.filter(def => def.category === category));

export function getWidget(type: string): WidgetDef | undefined {
	return Object.hasOwn(BY_TYPE, type) ? BY_TYPE[type] : undefined;
}

/** Every widget, ordered by category then registration order. */
export function allWidgets(): readonly WidgetDef[] {
	return ORDERED;
}
