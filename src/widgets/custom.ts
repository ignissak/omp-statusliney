import { truncateToWidth } from "@oh-my-pi/pi-tui";
import { getProjectDir, logger } from "@oh-my-pi/pi-utils";
import type { RenderEnv, WidgetDef } from "./types";

interface CommandEntry {
	value?: string;
	fetchedAt: number;
	inFlight: boolean;
}

const commandCache = new Map<string, CommandEntry>();

function numberOption(value: unknown, fallback: number): number {
	return typeof value === "number" ? value : fallback;
}

function runCommand(env: RenderEnv, command: string, timeout: number, cacheMs: number, maxWidth: number): string | undefined {
	let entry = commandCache.get(command);
	if (!entry) {
		entry = { fetchedAt: 0, inFlight: false };
		commandCache.set(command, entry);
	}
	const exec = env.data.exec;
	const now = Date.now();
	// Never re-run faster than the repaint ticker: every result triggers a repaint.
	const ttl = Math.max(cacheMs, env.data.getConfig().refreshMs);
	if (exec && !entry.inFlight && (entry.fetchedAt === 0 || now - entry.fetchedAt >= ttl)) {
		const target = entry;
		const previous = target.value;
		target.inFlight = true;
		target.fetchedAt = now;
		exec("sh", ["-c", command], { cwd: getProjectDir(), timeout })
			.then(result => {
				if (result.code !== 0 || result.killed) {
					target.value = undefined;
					logger.debug("statusliney: custom command failed", { command, code: result.code });
					return;
				}
				const line = result.stdout.split("\n").find(candidate => candidate.trim() !== "") ?? "";
				target.value = Bun.stripANSI(line);
			})
			.catch(error => {
				target.value = undefined;
				logger.debug("statusliney: custom command failed", { command, error: String(error) });
			})
			.finally(() => {
				target.inFlight = false;
				if (target.value !== previous) env.requestRender();
			});
	}
	if (entry.value === undefined) return undefined;
	return maxWidth > 0 ? truncateToWidth(entry.value, maxWidth) : entry.value;
}

export const CUSTOM_WIDGETS: readonly WidgetDef[] = [
	{
		type: "text",
		name: "Text",
		description: "Static text",
		category: "custom",
		kind: "content",
		options: [{ key: "text", label: "Text", kind: "string", default: "text" }],
		render(item, env) {
			const text = typeof item.options?.text === "string" ? item.options.text : "text";
			const clean = Bun.stripANSI(text);
			if (!clean) return null;
			return item.color ? clean : env.theme.fg("text", clean);
		},
	},
	{
		type: "custom_command",
		name: "Command output",
		description: "First line of a shell command's output, cached",
		category: "custom",
		kind: "content",
		options: [
			{ key: "command", label: "Command", kind: "string", default: "" },
			{ key: "timeoutMs", label: "Timeout (ms)", kind: "number", min: 100, max: 10_000, default: 1_000 },
			{ key: "cacheMs", label: "Cache (ms)", kind: "number", min: 0, max: 600_000, default: 5_000 },
			{ key: "maxWidth", label: "Max width (0 = unlimited)", kind: "number", min: 0, max: 200, default: 40 },
		],
		render(item, env) {
			const command = typeof item.options?.command === "string" ? item.options.command.trim() : "";
			if (!command) return null;
			const value = runCommand(
				env,
				command,
				numberOption(item.options?.timeoutMs, 1_000),
				numberOption(item.options?.cacheMs, 5_000),
				numberOption(item.options?.maxWidth, 40),
			);
			if (value) return value;
			return env.preview ? env.theme.fg("dim", "[cmd]") : null;
		},
	},
	{
		type: "link",
		name: "Link",
		description: "Clickable OSC 8 hyperlink",
		category: "custom",
		kind: "content",
		options: [
			{ key: "url", label: "URL", kind: "string", default: "" },
			{ key: "text", label: "Text", kind: "string", default: "" },
		],
		render(item, env) {
			const url = typeof item.options?.url === "string" ? item.options.url.trim() : "";
			if (!url) return null;
			const text = typeof item.options?.text === "string" && item.options.text ? item.options.text : url;
			return env.theme.fg("mdLink", `\x1b]8;;${url}\x1b\\${Bun.stripANSI(text)}\x1b]8;;\x1b\\`);
		},
	},
];

export const LAYOUT_WIDGETS: readonly WidgetDef[] = [
	{
		type: "separator",
		name: "Separator",
		description: "Explicit separator; replaces the automatic one on both sides",
		category: "layout",
		kind: "separator",
		options: [{ key: "char", label: "Character", kind: "string", default: "|" }],
		render(item, env) {
			const char = typeof item.options?.char === "string" ? Bun.stripANSI(item.options.char) : "|";
			return env.theme.fg("statusLineSep", char);
		},
	},
	{
		type: "flex",
		name: "Flex space",
		description: "Flexible gap; pushes the following widgets right",
		category: "layout",
		kind: "flex",
		options: [],
		render: () => "",
		renderFlex(_item, env, width) {
			if (env.surface === "free") return " ".repeat(width);
			return `\x1b[49m${env.theme.fg("border", env.theme.boxRound.horizontal.repeat(width))}`;
		},
	},
];
