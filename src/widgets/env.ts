import * as os from "node:os";
import { getContextUsageLevel, getContextUsageThemeColor } from "@oh-my-pi/pi-tui/chrome/context-thresholds";
import { thinkingLevelWord } from "@oh-my-pi/pi-tui/status-line";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import { thinkingLevelToken } from "@oh-my-pi/pi-tui/theme/theme-class";
import { formatNumber, VERSION } from "@oh-my-pi/pi-utils";
import type { WidgetDef } from "./types";

function bar(theme: Theme, percent: number, width: number, filledColor: Parameters<Theme["fg"]>[0]): string {
	const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
	return (
		theme.fg(filledColor, theme.progress.filled.repeat(filled)) +
		theme.fg("border", theme.progress.empty.repeat(width - filled))
	);
}

const QUOTA_WINDOWS = ["5h", "1d", "7d", "mo"] as const;

export const CONTEXT_WIDGETS: readonly WidgetDef[] = [
	{
		type: "context_bar",
		name: "Context bar",
		description: "Context usage as a fixed-width progress bar",
		category: "context",
		kind: "content",
		options: [
			{ key: "width", label: "Width", kind: "number", min: 4, max: 40, default: 10 },
			{ key: "showPercent", label: "Show percent", kind: "bool", default: true },
		],
		render(item, env) {
			const { contextWindow, contextPercent } = env.ctx;
			if (contextWindow <= 0) return null;
			const width = typeof item.options?.width === "number" ? item.options.width : 10;
			const percent = contextPercent ?? 0;
			const color = getContextUsageThemeColor(getContextUsageLevel(percent, contextWindow));
			let out = `${env.theme.icon.context} ${bar(env.theme, percent, width, color)}`;
			if (item.options?.showPercent !== false) {
				out += ` ${contextPercent === null ? "?" : `${Math.round(contextPercent)}%`}`;
			}
			return out;
		},
	},
	{
		type: "context_remaining",
		name: "Context left",
		description: "Tokens left in the context window",
		category: "context",
		kind: "content",
		options: [],
		render(_item, env) {
			const { contextWindow, contextTokens } = env.ctx;
			if (contextWindow <= 0) return null;
			const left = formatNumber(Math.max(0, contextWindow - contextTokens));
			return env.theme.fg("statusLineContext", `${env.theme.icon.context} ${left} left`);
		},
	},
	{
		type: "quota_bar",
		name: "Quota bar",
		description: "Provider usage-limit window as a progress bar",
		category: "context",
		kind: "content",
		options: [{ key: "window", label: "Window", kind: "enum", values: QUOTA_WINDOWS, default: "5h" }],
		render(item, env) {
			const usage = env.ctx.usage;
			const window = QUOTA_WINDOWS.find(value => value === item.options?.window) ?? "5h";
			const entry =
				window === "5h"
					? usage?.fiveHour
					: window === "1d"
						? usage?.daily
						: window === "7d"
							? usage?.sevenDay
							: usage?.monthly;
			if (!entry) return null;
			const color = entry.percent >= 80 ? "error" : entry.percent >= 50 ? "warning" : "muted";
			return `${env.theme.fg("muted", window)} ${bar(env.theme, entry.percent, 8, color)} ${env.theme.fg(color, `${Math.round(entry.percent)}%`)}`;
		},
	},
];

export const ENV_WIDGETS: readonly WidgetDef[] = [
	{
		type: "thinking",
		name: "Thinking level",
		description: "Thinking effort as its own widget",
		category: "environment",
		kind: "content",
		options: [{ key: "showWord", label: "Show word", kind: "bool", default: true }],
		render(item, env) {
			const level = thinkingLevelWord(env.ctx.session);
			if (level === undefined) return null;
			const symbols: Record<string, string> = env.theme.thinking;
			let display: string;
			if (level === "off") display = `${env.theme.status.disabled} off`;
			else if (level === "auto") display = `${env.theme.thinking.autoPending} auto`;
			else display = symbols[level] ?? level;
			if (item.options?.showWord === false) display = display.split(" ")[0] || display;
			return env.theme.fg(thinkingLevelToken(level), display);
		},
	},
	{
		type: "provider",
		name: "Provider",
		description: "Active model provider",
		category: "environment",
		kind: "content",
		options: [],
		render(_item, env) {
			const provider = env.ctx.session.state.model?.provider;
			return provider ? env.theme.fg("muted", provider) : null;
		},
	},
	{
		type: "omp_version",
		name: "omp version",
		description: "Running omp version",
		category: "environment",
		kind: "content",
		options: [],
		render: (_item, env) => env.theme.fg("muted", `v${VERSION}`),
	},
	{
		type: "terminal_width",
		name: "Terminal width",
		description: "Width available to the bar, in columns",
		category: "environment",
		kind: "content",
		options: [],
		render: (_item, env) => env.theme.fg("muted", `${env.width} cols`),
	},
	{
		type: "memory",
		name: "Memory",
		description: "System memory in use",
		category: "environment",
		kind: "content",
		options: [],
		render(_item, env) {
			const total = os.totalmem();
			const used = total - os.freemem();
			return env.theme.fg("muted", `Mem ${(used / 2 ** 30).toFixed(1)}/${(total / 2 ** 30).toFixed(0)}G`);
		},
	},
];
