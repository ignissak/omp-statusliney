import { settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgGitEnabled } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { getProjectDir, logger } from "@oh-my-pi/pi-utils";
import type { RenderEnv, WidgetDef } from "./types";

interface GitExtras {
	sha: string | null;
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	insertions: number;
	deletions: number;
	stash: number;
	fetchedAt: number;
}

interface CacheEntry {
	value?: GitExtras;
	fetchedAt: number;
	inFlight: boolean;
}

const cache = new Map<string, CacheEntry>();

const GIT_TIMEOUT_MS = 2000;

export function parseStatusV2(stdout: string): Pick<GitExtras, "sha" | "ahead" | "behind" | "hasUpstream"> {
	let sha: string | null = null;
	let ahead = 0;
	let behind = 0;
	let hasUpstream = false;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("# branch.oid ")) {
			const oid = line.slice("# branch.oid ".length).trim();
			sha = /^[0-9a-f]{7,}$/.test(oid) ? oid : null;
		} else if (line.startsWith("# branch.ab ")) {
			const match = /\+(\d+) -(\d+)/.exec(line);
			if (match) {
				hasUpstream = true;
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
		}
	}
	return { sha, ahead, behind, hasUpstream };
}

async function fetchExtras(env: RenderEnv, cwd: string): Promise<GitExtras | undefined> {
	const exec = env.data.exec;
	if (!exec) return undefined;
	const options = { cwd, timeout: GIT_TIMEOUT_MS };
	const [status, diff, stash] = await Promise.all([
		exec("git", ["status", "--porcelain=v2", "--branch"], options),
		exec("git", ["diff", "--shortstat", "HEAD"], options),
		exec("git", ["rev-list", "--walk-reflogs", "--count", "refs/stash"], options),
	]);
	if (status.code !== 0) return undefined;
	const insertions = /(\d+) insertion/.exec(diff.stdout);
	const deletions = /(\d+) deletion/.exec(diff.stdout);
	const stashCount = stash.code === 0 ? Number.parseInt(stash.stdout.trim(), 10) : 0;
	return {
		...parseStatusV2(status.stdout),
		insertions: insertions ? Number(insertions[1]) : 0,
		deletions: deletions ? Number(deletions[1]) : 0,
		stash: Number.isFinite(stashCount) ? stashCount : 0,
		fetchedAt: Date.now(),
	};
}

/** Cached git extras for the active repo; refreshes in the background when stale. */
function gitExtras(env: RenderEnv): GitExtras | undefined {
	const cwd = env.ctx.activeRepo?.repoRoot ?? getProjectDir();
	let entry = cache.get(cwd);
	if (!entry) {
		entry = { fetchedAt: 0, inFlight: false };
		cache.set(cwd, entry);
	}
	const now = Date.now();
	if (!entry.inFlight && now - entry.fetchedAt >= env.data.getConfig().gitRefreshMs) {
		const target = entry;
		target.inFlight = true;
		target.fetchedAt = now;
		fetchExtras(env, cwd)
			.then(value => {
				if (value) target.value = value;
			})
			.catch(error => logger.debug("statusliney: git extras failed", { error: String(error) }))
			.finally(() => {
				target.inFlight = false;
				env.requestRender();
			});
	}
	return entry.value;
}

function gitAvailable(env: RenderEnv): boolean {
	return cfgGitEnabled.get(settings) && env.ctx.git.branch !== null;
}

export const GIT_WIDGETS: readonly WidgetDef[] = [
	{
		type: "git_ahead_behind",
		name: "Ahead/behind",
		description: "Commits ahead of / behind the upstream branch",
		category: "git",
		kind: "content",
		options: [],
		render(_item, env) {
			if (!gitAvailable(env)) return null;
			const extras = gitExtras(env);
			if (!extras?.hasUpstream || (extras.ahead === 0 && extras.behind === 0)) return null;
			const ascii = env.theme.getSymbolPreset() === "ascii";
			const parts: string[] = [];
			if (extras.ahead > 0) parts.push(`${ascii ? "^" : "↑"}${extras.ahead}`);
			if (extras.behind > 0) parts.push(`${ascii ? "v" : "↓"}${extras.behind}`);
			return env.theme.fg("accent", parts.join(ascii ? " " : ""));
		},
	},
	{
		type: "git_sha",
		name: "Commit SHA",
		description: "Short HEAD commit hash",
		category: "git",
		kind: "content",
		options: [],
		render(_item, env) {
			if (!gitAvailable(env)) return null;
			const sha = gitExtras(env)?.sha;
			return sha ? env.theme.fg("muted", `${env.theme.icon.git} ${sha.slice(0, 7)}`) : null;
		},
	},
	{
		type: "git_changes",
		name: "Line changes",
		description: "Inserted/deleted lines against HEAD",
		category: "git",
		kind: "content",
		options: [],
		render(_item, env) {
			if (!gitAvailable(env)) return null;
			const extras = gitExtras(env);
			if (!extras || (extras.insertions === 0 && extras.deletions === 0)) return null;
			return `${env.theme.fg("toolDiffAdded", `+${extras.insertions}`)} ${env.theme.fg("toolDiffRemoved", `-${extras.deletions}`)}`;
		},
	},
	{
		type: "git_stash",
		name: "Stash count",
		description: "Number of stash entries",
		category: "git",
		kind: "content",
		options: [],
		render(_item, env) {
			if (!gitAvailable(env)) return null;
			const stash = gitExtras(env)?.stash ?? 0;
			return stash > 0 ? env.theme.fg("muted", `${env.theme.icon.pin} ${stash}`) : null;
		},
	},
	{
		type: "git_clean",
		name: "Clean/dirty",
		description: "Working tree clean or dirty marker",
		category: "git",
		kind: "content",
		options: [],
		render(_item, env) {
			if (!gitAvailable(env)) return null;
			const status = env.ctx.git.status;
			if (!status) return null;
			const clean = status.staged === 0 && status.unstaged === 0 && status.untracked === 0;
			return clean
				? env.theme.fg("statusLineGitClean", env.theme.status.success)
				: env.theme.fg("statusLineGitDirty", env.theme.status.warning);
		},
	},
];

/** Widget types that need the built-in git segment's data (repo + status) injected. */
export const GIT_EXTRA_TYPES: Readonly<Record<string, true>> = {
	git_ahead_behind: true,
	git_sha: true,
	git_changes: true,
	git_stash: true,
	git_clean: true,
};
