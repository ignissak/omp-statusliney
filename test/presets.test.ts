import { describe, expect, test } from "bun:test";
import { STATUS_LINE_PRESETS } from "@oh-my-pi/pi-tui/status-line";
import { builtinPresetLines } from "../src/presets";

const types = (lines: { type: string }[][]) => lines.map(line => line.map(item => item.type));

describe("builtinPresetLines", () => {
	test("default preset mirrors the built-in bar order", () => {
		const { leftSegments, rightSegments } = STATUS_LINE_PRESETS.default;
		expect(types(builtinPresetLines(leftSegments, rightSegments))).toEqual([
			[
				"pi",
				"vim",
				"model",
				"mode",
				"collab",
				"stream",
				"path",
				"git",
				"pr",
				"context_pct",
				"cost",
				"context_gauge",
				"subagents",
				"jobs",
				"session_name",
			],
		]);
	});

	test("full preset moves subagents out of the left group", () => {
		const { leftSegments, rightSegments } = STATUS_LINE_PRESETS.full;
		const [line] = types(builtinPresetLines(leftSegments, rightSegments));
		const gauge = line.indexOf("context_gauge");
		expect(line.indexOf("subagents")).toBe(gauge + 1);
		expect(line.filter(type => type === "subagents")).toHaveLength(1);
	});
});
