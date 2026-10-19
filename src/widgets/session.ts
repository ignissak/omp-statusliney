import { formatDuration, isRecord } from "@oh-my-pi/pi-utils";
import type { RenderEnv, WidgetDef } from "./types";

interface BranchCounts {
	leafId: string | null;
	manager: unknown;
	turns: number;
	compactions: number;
}

let branchMemo: BranchCounts | undefined;

/** User turns and compactions on the current branch, cached by leaf id. */
function branchCounts(env: RenderEnv): BranchCounts | undefined {
	const manager = env.data.sessionManager;
	if (!manager) return undefined;
	const leafId = manager.getLeafId();
	if (branchMemo && branchMemo.manager === manager && branchMemo.leafId === leafId) return branchMemo;
	let turns = 0;
	let compactions = 0;
	for (const entry of manager.getBranch()) {
		const record: unknown = entry;
		if (!isRecord(record)) continue;
		if (record.type === "compaction") compactions++;
		else if (record.type === "message" && isRecord(record.message) && record.message.role === "user") turns++;
	}
	branchMemo = { leafId, manager, turns, compactions };
	return branchMemo;
}

export const SESSION_WIDGETS: readonly WidgetDef[] = [
	{
		type: "cost_rate",
		name: "Cost rate",
		description: "Spend per hour of active processing time",
		category: "session",
		kind: "content",
		options: [],
		render(_item, env) {
			const cost = env.ctx.usageStats.cost;
			if (env.ctx.activeMs < 60_000 || cost === 0) return null;
			return env.theme.fg("statusLineCost", `$${(cost / (env.ctx.activeMs / 3_600_000)).toFixed(2)}/h`);
		},
	},
	{
		type: "turns",
		name: "Turns",
		description: "User turns on the current branch",
		category: "session",
		kind: "content",
		options: [],
		render(_item, env) {
			const turns = branchCounts(env)?.turns ?? 0;
			return turns > 0 ? env.theme.fg("muted", `${turns} turns`) : null;
		},
	},
	{
		type: "compactions",
		name: "Compactions",
		description: "Compactions on the current branch",
		category: "session",
		kind: "content",
		options: [],
		render(_item, env) {
			const compactions = branchCounts(env)?.compactions ?? 0;
			return compactions > 0 ? env.theme.fg("muted", `${env.theme.icon.rewind} ${compactions}`) : null;
		},
	},
	{
		type: "session_clock",
		name: "Session age",
		description: "Wall-clock time since the session started",
		category: "session",
		kind: "content",
		options: [],
		render(_item, env) {
			const timestamp = env.data.sessionManager?.getHeader()?.timestamp;
			const start = timestamp ? Date.parse(timestamp) : Number.NaN;
			if (Number.isNaN(start)) return null;
			return env.theme.fg("muted", `${env.theme.icon.time} ${formatDuration(Math.max(0, Date.now() - start))}`);
		},
	},
	{
		type: "tool",
		name: "Tool activity",
		description: "Running tool, or the last finished tool",
		category: "session",
		kind: "content",
		options: [{ key: "showLast", label: "Show last tool", kind: "bool", default: true }],
		render(item, env) {
			const { running, last } = env.data.tools;
			if (running) return env.theme.fg("accent", `${env.theme.status.running} ${running}`);
			if (last && item.options?.showLast !== false) return env.theme.fg("dim", last);
			return null;
		},
	},
];
