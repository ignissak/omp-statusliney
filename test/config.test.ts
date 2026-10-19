import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeConfig, type WidgetItem } from "../src/config";
import { ConfigStore } from "../src/store";

const fallback = (): WidgetItem[][] => [[{ id: "fb", type: "model" }]];

const dirs: string[] = [];
function tempFile(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sly-"));
	dirs.push(dir);
	return path.join(dir, "statusliney.json");
}

afterEach(() => {
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("normalizeConfig", () => {
	test("drops unknown widget types with a warning", () => {
		const { config, warnings } = normalizeConfig(
			{ lines: [[{ id: "a", type: "nope" }, { id: "b", type: "model" }]] },
			fallback,
		);
		expect(config.lines).toEqual([[{ id: "b", type: "model" }]]);
		expect(warnings.some(w => w.includes("nope"))).toBe(true);
	});

	test("clamps numbers into range", () => {
		const { config } = normalizeConfig({ refreshMs: 5, gitRefreshMs: 10_000_000 }, fallback);
		expect(config.refreshMs).toBe(250);
		expect(config.gitRefreshMs).toBe(60_000);
	});

	test("invalid lines fall back to the built-in layout", () => {
		expect(normalizeConfig({ lines: "x" }, fallback).config.lines).toEqual(fallback());
	});

	test("drops undeclared option keys and mistyped option values", () => {
		const { config } = normalizeConfig(
			{ lines: [[{ id: "a", type: "context_bar", options: { width: 12, bogus: 1, showPercent: "yes" } }]] },
			fallback,
		);
		expect(config.lines[0][0].options).toEqual({ width: 12 });
	});
});

describe("ConfigStore", () => {
	test("save then load round-trips byte-identically", async () => {
		const file = tempFile();
		const store = new ConfigStore(file, fallback);
		store.load();
		store.update(c => ({ ...c, placement: "bottom", lines: [[{ id: "t", type: "text", options: { text: "hi" } }]] }));
		store.dispose();
		const written = fs.readFileSync(file, "utf8");

		const again = new ConfigStore(file, fallback);
		again.load();
		expect(again.get().placement).toBe("bottom");
		again.update(c => c);
		again.dispose();
		expect(fs.readFileSync(file, "utf8")).toBe(written);
	});

	test("invalid JSON is left unmodified and falls back in memory", () => {
		const file = tempFile();
		fs.writeFileSync(file, "{ not json");
		const store = new ConfigStore(file, fallback);
		store.load();
		expect(store.get().lines).toEqual(fallback());
		expect(store.warnings.some(w => w.includes("invalid JSON"))).toBe(true);
		store.dispose();
		expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
	});
});
