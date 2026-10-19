/**
 * Release notes from Conventional Commits between the previous `v*` tag and HEAD.
 *
 * Usage: bun scripts/release-notes.ts <tag>   (prints Markdown to stdout)
 */

export interface Commit {
	sha: string;
	subject: string;
	body: string;
}

export interface NotesContext {
	repoUrl: string;
	previousTag: string | undefined;
	tag: string;
}

const SECTIONS = [
	{ title: "Breaking changes", types: [] },
	{ title: "Features", types: ["feat"] },
	{ title: "Fixes", types: ["fix"] },
	{ title: "Performance", types: ["perf"] },
	{ title: "Other changes", types: [] },
] as const;

type SectionTitle = (typeof SECTIONS)[number]["title"];

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?: (?<description>.+)$/;
const SEMVER = /\b\d+\.\d+\.\d+\b/;

/** Group commits into Markdown sections; version-bump chores are left out. */
export function renderReleaseNotes(commits: readonly Commit[], context: NotesContext): string {
	const sections: Record<SectionTitle, string[]> = {
		"Breaking changes": [],
		Features: [],
		Fixes: [],
		Performance: [],
		"Other changes": [],
	};
	for (const commit of commits) {
		const match = CONVENTIONAL.exec(commit.subject.trim());
		const type = match?.groups?.type;
		const scope = match?.groups?.scope;
		const description = match?.groups?.description ?? commit.subject.trim();
		if (type === "chore" && (scope === "release" || SEMVER.test(description))) continue;
		const link = `([${commit.sha.slice(0, 7)}](${context.repoUrl}/commit/${commit.sha}))`;
		const line = `- ${scope ? `**${scope}:** ` : ""}${description} ${link}`;
		const breaking = match?.groups?.bang === "!" || /^BREAKING[ -]CHANGE:/m.test(commit.body);
		const section = breaking
			? "Breaking changes"
			: (SECTIONS.find(candidate => candidate.types.some(t => t === type))?.title ?? "Other changes");
		sections[section].push(line);
	}
	let out = "";
	for (const { title } of SECTIONS) {
		if (sections[title].length === 0) continue;
		out += `## ${title}\n\n${sections[title].join("\n")}\n\n`;
	}
	if (out === "") out = "No notable changes.\n\n";
	if (context.previousTag) {
		out += `**Full changelog:** ${context.repoUrl}/compare/${context.previousTag}...${context.tag}\n`;
	}
	return out;
}

async function git(args: string[]): Promise<{ ok: boolean; stdout: string }> {
	const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
	const stdout = await new Response(proc.stdout).text();
	return { ok: (await proc.exited) === 0, stdout };
}

async function main(): Promise<void> {
	const tag = process.argv[2];
	if (!tag) throw new Error("usage: bun scripts/release-notes.ts <tag>");
	const previous = await git(["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"]);
	const previousTag = previous.ok && previous.stdout.trim() !== tag ? previous.stdout.trim() : undefined;
	const log = await git(["log", "--format=%H%x1f%s%x1f%b%x1e", previousTag ? `${previousTag}..HEAD` : "HEAD"]);
	const commits = log.stdout
		.split("\x1e")
		.map(record => record.trim())
		.filter(record => record !== "")
		.map(record => {
			const [sha = "", subject = "", body = ""] = record.split("\x1f");
			return { sha, subject, body };
		});
	const repoUrl =
		process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
			? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
			: "https://github.com/ignissak/omp-statusliney";
	process.stdout.write(renderReleaseNotes(commits, { repoUrl, previousTag, tag }));
}

if (import.meta.main) await main();
