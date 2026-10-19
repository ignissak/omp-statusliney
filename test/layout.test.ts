import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { type LayoutPart, type LayoutStyle, layoutLine } from "../src/layout";

const plain: LayoutStyle = { bg: "", fg: "", sep: "", sepLeft: "|", sepRight: "|" };

function content(text: string, extra: Partial<LayoutPart> = {}): LayoutPart {
	return { id: text, type: "text", kind: "content", text, ...extra };
}

const flex = (char = "-"): LayoutPart => ({
	id: "flex",
	type: "flex",
	kind: "flex",
	text: "",
	fill: width => char.repeat(width),
});

const strip = (text: string) => Bun.stripANSI(text);

describe("layoutLine", () => {
	test("joins content parts with the automatic separator", () => {
		expect(strip(layoutLine([content("a"), content("b")], 80, plain))).toBe(" a | b ");
	});

	test("explicit separator part replaces automatic separators on both sides", () => {
		const sep: LayoutPart = { id: "s", type: "separator", kind: "separator", text: "#" };
		expect(strip(layoutLine([content("a"), sep, content("b")], 80, plain))).toBe(" a # b ");
	});

	test("flex fills the row exactly with groups at both edges", () => {
		const out = strip(layoutLine([content("left"), flex(), content("right")], 30, plain));
		expect(visibleWidth(out)).toBe(30);
		expect(out.startsWith(" left ")).toBe(true);
		expect(out.endsWith(" right ")).toBe(true);
	});

	test("overflow drops the last group first, then shrinks path, never path before other group-0 parts", () => {
		const longPath = "/a/very/long/path/to/some/project";
		const path = content(longPath, {
			elastic: "path",
			reshrink: max => longPath.slice(longPath.length - max),
		});
		const parts = [content("model"), path, content("git"), flex(), content("r1"), content("r2")];
		// Fits only after the right group is gone and path shrank.
		const out = strip(layoutLine(parts, 40, plain));
		expect(out).not.toContain("r1");
		expect(out).not.toContain("r2");
		expect(out).toContain("model");
		expect(out).toContain("git");
		expect(visibleWidth(out)).toBeLessThanOrEqual(40);
		expect(out).not.toContain(longPath);

		// Too narrow for everything: git and model drop before the path does.
		const narrow = strip(layoutLine(parts, 14, plain));
		expect(narrow).not.toContain("git");
		expect(narrow).not.toContain("model");
		expect(narrow.trim().length).toBeGreaterThan(0);
	});

	test("session title is truncated to 8 cells before anything drops", () => {
		const title = content("A very long session title", { elastic: "title" });
		const parts = [content("model"), flex(), title];
		const out = strip(layoutLine(parts, 30, plain));
		expect(out).toContain("model");
		expect(visibleWidth(out)).toBe(30);
		expect(out).toContain("A very");
		expect(out).not.toContain("title");
	});

	test("caps render only when the style defines them", () => {
		const withCaps: LayoutStyle = {
			...plain,
			bg: "\x1b[48;5;1m",
			caps: { left: "<", right: ">", useBgAsFg: true },
		};
		expect(strip(layoutLine([content("a")], 80, withCaps))).toBe(" a >");
		expect(strip(layoutLine([content("a"), flex(), content("b")], 20, withCaps))).toBe(` a >${"-".repeat(12)}< b `);
		expect(strip(layoutLine([content("a")], 80, plain))).toBe(" a ");
	});
});
