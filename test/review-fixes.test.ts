import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setNativeRendering } from "@oh-my-pi/pi-tui";
import { StatusLineComponent, type StatusLineSettings } from "@oh-my-pi/pi-tui/status-line";
import { normalizeConfig, type StatuslineyConfig, type WidgetItem } from "../src/config";
import { ConfigStore } from "../src/store";
import { injectedSettings, installTakeover, type Renderer, takeoverState } from "../src/takeover";
import { getWidget } from "../src/widgets/registry";
import type { RenderEnv } from "../src/widgets/types";

const fallback = (): WidgetItem[][] => [[{ id: "fb", type: "model" }]];

const dirs: string[] = [];
function tempFile(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sly-"));
	dirs.push(dir);
	return path.join(dir, "statusliney.json");
}

afterEach(() => {
	setNativeRendering(false);
	for (const dir of dirs.splice(0)) {
		fs.chmodSync(dir, 0o755);
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("TSP terminals keep the native statusline", () => {
	test("injection passes real settings through while native rendering is active", () => {
		const real: StatusLineSettings = { preset: "default", showHookStatus: true };
		expect(injectedSettings(real, ["session", "model"]).leftSegments).toEqual(["session", "model"]);
		setNativeRendering(true);
		expect(injectedSettings(real, ["session", "model"])).toEqual(real);
	});
});

describe("renderer failures never escape into the TUI", () => {
	test("a throwing renderer yields empty output and disables the takeover after repeated failures", () => {
		const renderer: Renderer = {
			requiredSegments: () => ["session"],
			slot: () => {
				throw new Error("boom");
			},
			bottom: () => {
				throw new Error("boom");
			},
			previewForStyle: () => {
				throw new Error("boom");
			},
		};
		installTakeover(renderer);
		const state = takeoverState();
		// Plain object stand-in: marked as seen so first-sight injection does not touch private fields.
		const fake = Object.create(StatusLineComponent.prototype) as StatusLineComponent;
		state.seen.add(fake);
		expect(fake.render(80)).toEqual([]);
		expect(fake.getBandTopBorder(80).content).toBe("");
		expect(state.disabled).not.toBe(true);
		expect(fake.render(80)).toEqual([]);
		expect(state.disabled).toBe(true);
		state.disabled = false;
		state.failures = 0;
	});
});

describe("custom_command", () => {
	test("never re-runs faster than the refresh interval, even with cacheMs 0", async () => {
		let runs = 0;
		let renders = 0;
		let rendered: () => void = () => {};
		const firstRender = new Promise<void>(resolve => {
			rendered = resolve;
		});
		const config = { refreshMs: 1000 } as StatuslineyConfig; // only refreshMs is read by the widget
		const env = {
			preview: false,
			requestRender: () => {
				renders++;
				rendered();
			},
			data: {
				tools: {},
				getConfig: () => config,
				exec: async () => {
					runs++;
					return { stdout: "same\n", stderr: "", code: 0, killed: false };
				},
			},
		} as unknown as RenderEnv; // custom_command reads only data, preview and requestRender
		const def = getWidget("custom_command");
		const item: WidgetItem = { id: "c", type: "custom_command", options: { command: "echo loop-test", cacheMs: 0 } };
		def?.render(item, env);
		await firstRender;
		expect(def?.render(item, env)).toBe("same");
		def?.render(item, env);
		expect(runs).toBe(1);
		expect(renders).toBe(1);
	});
});

describe("config resilience", () => {
	test("a single malformed line is dropped, not the whole layout", () => {
		const { config, warnings } = normalizeConfig({ lines: [[{ id: "a", type: "model" }], { type: "text" }] }, fallback);
		expect(config.lines).toEqual([[{ id: "a", type: "model" }]]);
		expect(warnings.length).toBeGreaterThan(0);
	});

	test("an external edit with invalid lines keeps the previous config and reports a warning", () => {
		const file = tempFile();
		fs.writeFileSync(file, JSON.stringify({ version: 1, lines: [[{ id: "t", type: "text" }]] }));
		const store = new ConfigStore(file, fallback);
		store.load();
		fs.writeFileSync(file, JSON.stringify({ version: 1, lines: "broken" }));
		store.reload();
		expect(store.get().lines).toEqual([[{ id: "t", type: "text" }]]);
		expect(store.takeWarnings().some(w => w.includes("lines"))).toBe(true);
		store.dispose();
	});

	test("an unreadable config file is never overwritten", () => {
		if (process.getuid?.() === 0) return;
		const file = tempFile();
		fs.writeFileSync(file, '{"version":1}');
		fs.chmodSync(file, 0o000);
		const store = new ConfigStore(file, fallback);
		store.load();
		store.dispose();
		fs.chmodSync(file, 0o644);
		expect(fs.readFileSync(file, "utf8")).toBe('{"version":1}');
	});
});
