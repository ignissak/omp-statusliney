import { describe, expect, test } from "bun:test";
import { renderReleaseNotes } from "../scripts/release-notes";

const repo = "https://github.com/ignissak/omp-statusliney";

describe("renderReleaseNotes", () => {
	test("groups conventional commits and links each one", () => {
		const notes = renderReleaseNotes(
			[
				{ sha: "aaaaaaa1", subject: "feat(ui): settings panel", body: "" },
				{ sha: "bbbbbbb2", subject: "fix: keep native statusline", body: "" },
				{ sha: "ccccccc3", subject: "docs: add README", body: "" },
				{ sha: "ddddddd4", subject: "random subject", body: "" },
			],
			{ repoUrl: repo, previousTag: "v1.0.0", tag: "v1.1.0" },
		);
		expect(notes).toBe(
			[
				"## Features",
				"",
				`- **ui:** settings panel ([aaaaaaa](${repo}/commit/aaaaaaa1))`,
				"",
				"## Fixes",
				"",
				`- keep native statusline ([bbbbbbb](${repo}/commit/bbbbbbb2))`,
				"",
				"## Other changes",
				"",
				`- add README ([ccccccc](${repo}/commit/ccccccc3))`,
				`- random subject ([ddddddd](${repo}/commit/ddddddd4))`,
				"",
				`**Full changelog:** ${repo}/compare/v1.0.0...v1.1.0`,
				"",
			].join("\n"),
		);
	});

	test("breaking changes lead, version bumps are dropped, first release has no compare link", () => {
		const notes = renderReleaseNotes(
			[
				{ sha: "aaaaaaa1", subject: "feat!: new config format", body: "" },
				{ sha: "bbbbbbb2", subject: "fix: thing", body: "BREAKING CHANGE: lines renamed" },
				{ sha: "ccccccc3", subject: "chore(release): 1.0.0", body: "" },
				{ sha: "ddddddd4", subject: "chore: bump version to 1.0.0", body: "" },
			],
			{ repoUrl: repo, previousTag: undefined, tag: "v1.0.0" },
		);
		expect(notes).toContain("## Breaking changes\n\n- new config format");
		expect(notes).toContain("- thing");
		expect(notes.indexOf("## Breaking changes")).toBe(0);
		expect(notes).not.toContain("1.0.0 (");
		expect(notes).not.toContain("bump version");
		expect(notes).not.toContain("compare");
	});
});
