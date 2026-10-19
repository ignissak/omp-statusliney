import * as path from "node:path";
import type { StatusLineSeparatorStyle } from "@oh-my-pi/pi-tui/status-line";
import { STATUS_LINE_SEPARATOR_VALUES } from "@oh-my-pi/pi-tui/status-line/schema";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { getAgentDir, isRecord } from "@oh-my-pi/pi-utils";
import { getWidget, WIDGET_COLOR_TOKENS } from "./widgets/registry";

export type Placement = "auto" | "top" | "bottom";
export type SeparatorChoice = "inherit" | StatusLineSeparatorStyle;
export type TriState = "inherit" | "on" | "off";
export type BackgroundChoice = "auto" | "on" | "off";
export type OptionValue = string | number | boolean;

export interface WidgetItem {
	id: string;
	type: string;
	color?: ThemeColor;
	bold?: boolean;
	label?: string;
	options?: Record<string, OptionValue>;
}

export interface StatuslineyConfig {
	version: 1;
	placement: Placement;
	separator: SeparatorChoice;
	background: BackgroundChoice;
	hookStatusRows: TriState;
	/** Repaint interval for clock-driven widgets, 250..10000 ms. */
	refreshMs: number;
	/** Git extras refresh interval, 1000..60000 ms. */
	gitRefreshMs: number;
	/** 1..6 lines; a line may be empty. */
	lines: WidgetItem[][];
}

export const PLACEMENTS: readonly Placement[] = ["auto", "top", "bottom"];
export const SEPARATOR_CHOICES: readonly SeparatorChoice[] = ["inherit", ...STATUS_LINE_SEPARATOR_VALUES];
export const BACKGROUND_CHOICES: readonly BackgroundChoice[] = ["auto", "on", "off"];
export const TRI_STATES: readonly TriState[] = ["inherit", "on", "off"];
export const MAX_LINES = 6;
export const REFRESH_RANGE = { min: 250, max: 10_000, default: 1_000 } as const;
export const GIT_REFRESH_RANGE = { min: 1_000, max: 60_000, default: 5_000 } as const;

export function defaultConfigPath(): string {
	return process.env.OMP_STATUSLINEY_CONFIG ?? path.join(getAgentDir(), "statusliney.json");
}

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
	return values.find(candidate => candidate === value) ?? fallback;
}

function clampInt(value: unknown, range: { min: number; max: number; default: number }): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return range.default;
	return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Validate one option value against its definition; undefined drops it. */
export function normalizeOptionValue(
	def: { kind: string; values?: readonly string[]; min?: number; max?: number },
	value: unknown,
): OptionValue | undefined {
	switch (def.kind) {
		case "bool":
			return typeof value === "boolean" ? value : undefined;
		case "enum":
			return typeof value === "string" && value !== "inherit" && def.values?.includes(value) ? value : undefined;
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
			const rounded = Math.round(value);
			return Math.min(def.max ?? rounded, Math.max(def.min ?? rounded, rounded));
		}
		case "string":
			return typeof value === "string" ? value : undefined;
		default:
			return undefined;
	}
}

function normalizeItem(raw: unknown, warnings: string[]): WidgetItem | undefined {
	if (!isRecord(raw) || typeof raw.type !== "string") {
		warnings.push("statusliney: dropped a widget without a type");
		return undefined;
	}
	const def = getWidget(raw.type);
	if (!def) {
		warnings.push(`statusliney: unknown widget type "${raw.type}" dropped`);
		return undefined;
	}
	const item: WidgetItem = {
		id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
		type: raw.type,
	};
	if (raw.color !== undefined) {
		const color = WIDGET_COLOR_TOKENS.find(token => token === raw.color);
		if (color) item.color = color;
		else warnings.push(`statusliney: unknown color "${String(raw.color)}" dropped from ${raw.type}`);
	}
	if (typeof raw.bold === "boolean") item.bold = raw.bold;
	if (typeof raw.label === "string" && raw.label) item.label = raw.label;
	if (isRecord(raw.options)) {
		const options: Record<string, OptionValue> = {};
		for (const [key, value] of Object.entries(raw.options)) {
			const optionDef = def.options.find(option => option.key === key);
			const normalized = optionDef ? normalizeOptionValue(optionDef, value) : undefined;
			if (normalized === undefined) {
				warnings.push(`statusliney: invalid option "${key}" dropped from ${raw.type}`);
				continue;
			}
			options[key] = normalized;
		}
		if (Object.keys(options).length > 0) item.options = options;
	}
	return item;
}

/** Type-guarded validation with defaults; never throws. */
export function normalizeConfig(
	raw: unknown,
	fallbackLines: () => WidgetItem[][],
): { config: StatuslineyConfig; warnings: string[] } {
	const warnings: string[] = [];
	const source = isRecord(raw) ? raw : {};
	let lines: WidgetItem[][];
	if (Array.isArray(source.lines) && source.lines.every(line => Array.isArray(line))) {
		const rawLines: unknown[][] = source.lines;
		if (rawLines.length > MAX_LINES) warnings.push(`statusliney: only the first ${MAX_LINES} lines are used`);
		lines = rawLines.slice(0, MAX_LINES).map(line => {
			const items: WidgetItem[] = [];
			for (const entry of line) {
				const item = normalizeItem(entry, warnings);
				if (item) items.push(item);
			}
			return items;
		});
		if (lines.length === 0) lines = [[]];
	} else {
		if (source.lines !== undefined) warnings.push("statusliney: invalid lines; using the built-in layout");
		lines = fallbackLines();
	}
	return {
		config: {
			version: 1,
			placement: pick(PLACEMENTS, source.placement, "auto"),
			separator: pick(SEPARATOR_CHOICES, source.separator, "inherit"),
			background: pick(BACKGROUND_CHOICES, source.background, "auto"),
			hookStatusRows: pick(TRI_STATES, source.hookStatusRows, "inherit"),
			refreshMs: clampInt(source.refreshMs, REFRESH_RANGE),
			gitRefreshMs: clampInt(source.gitRefreshMs, GIT_REFRESH_RANGE),
			lines,
		},
		warnings,
	};
}
