import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { statusLineHost } from "@oh-my-pi/pi-coding-agent/modes/status-line-host";
import { type ComposerStyle, type TUI, visibleWidth } from "@oh-my-pi/pi-tui";
import {
	SEGMENTS,
	type SegmentContext,
	type SegmentView,
	StatusLineComponent,
	type StatusLineSegmentId,
	type StatusLineSettings,
} from "@oh-my-pi/pi-tui/status-line";
import { getComposerCacheDbPath, logger } from "@oh-my-pi/pi-utils";

export type SlotSurface = "band" | "box";
export type ComposerStatusStyle = Pick<ComposerStyle, "statusAttachment" | "bottomBar" | "bottomBarGap">;
export type SlotResult = { content: string; width: number; revision: number };

/** What the patched component delegates to; swapped on every plugin (re)load. */
export interface Renderer {
	requiredSegments(): StatusLineSegmentId[];
	slot(inst: StatusLineComponent, surface: SlotSurface, width: number): string;
	bottom(inst: StatusLineComponent, width: number): string[];
	previewForStyle(
		inst: StatusLineComponent,
		width: number,
		style?: Pick<ComposerStyle, "statusAttachment" | "bottomBar">,
	): string[];
}

type Proto = StatusLineComponent;

interface Originals {
	getSettings: () => StatusLineSettings;
	updateSettings: Proto["updateSettings"];
	setComposerStyle: Proto["setComposerStyle"];
	setAutocompleteActiveProbe: Proto["setAutocompleteActiveProbe"];
	getTopBorder: Proto["getTopBorder"];
	getBandTopBorder: Proto["getBandTopBorder"];
	getStandaloneTopBorder: Proto["getStandaloneTopBorder"];
	renderBottomBar: Proto["renderBottomBar"];
	getPreviewLines: Proto["getPreviewLines"];
	render: Proto["render"];
	describeSession: (ctx: SegmentContext) => SegmentView | null;
}

export interface TakeoverState {
	originals?: Originals;
	renderer?: Renderer;
	userSettings: WeakMap<Proto, StatusLineSettings>;
	styles: WeakMap<Proto, ComposerStatusStyle>;
	autocomplete: WeakMap<Proto, () => boolean>;
	seen: WeakSet<Proto>;
	slots: WeakMap<Proto, Record<SlotSurface, { content: string; revision: number }>>;
	lastInstance?: Proto;
	tui?: TUI;
	capture: { active: boolean; ctx?: SegmentContext };
	frameCtx?: { inst: Proto; ctx: SegmentContext | undefined };
}

const STATE_KEY = Symbol.for("omp-statusliney.takeover");

type GlobalWithState = typeof globalThis & { [STATE_KEY]?: TakeoverState };

export function takeoverState(): TakeoverState {
	const global = globalThis as GlobalWithState;
	global[STATE_KEY] ??= {
		userSettings: new WeakMap(),
		styles: new WeakMap(),
		autocomplete: new WeakMap(),
		seen: new WeakSet(),
		slots: new WeakMap(),
		capture: { active: false },
	};
	return global[STATE_KEY];
}

/** The user's real `statusLine.*` settings, bypassing the patch. */
export function realStatusLineSettings(): StatusLineSettings {
	return (takeoverState().originals?.getSettings ?? statusLineHost.getSettings)();
}

const PATCHED_METHODS = [
	"updateSettings",
	"setComposerStyle",
	"setAutocompleteActiveProbe",
	"getTopBorder",
	"getBandTopBorder",
	"getStandaloneTopBorder",
	"renderBottomBar",
	"getPreviewLines",
	"describePreview",
	"render",
	"runningBackgroundJobCount",
] as const;

/** Every member the takeover relies on exists in this omp build. */
export function canTakeOver(): boolean {
	const proto: Record<string, unknown> = StatusLineComponent.prototype as unknown as Record<string, unknown>; // prototype members are looked up by name
	return (
		PATCHED_METHODS.every(name => typeof proto[name] === "function") &&
		typeof SEGMENTS.session?.describe === "function" &&
		typeof statusLineHost.getSettings === "function"
	);
}

function emptyLayout(settings: StatusLineSettings): StatusLineSettings {
	return { ...settings, preset: "custom", leftSegments: [], rightSegments: [], showHookStatus: false };
}

function firstSight(inst: Proto): void {
	const state = takeoverState();
	state.lastInstance = inst;
	if (state.seen.has(inst)) return;
	state.seen.add(inst);
	inst.updateSettings(state.userSettings.get(inst) ?? realStatusLineSettings());
}

function slotResult(inst: Proto, surface: SlotSurface, content: string): SlotResult {
	const state = takeoverState();
	let slots = state.slots.get(inst);
	if (!slots) {
		slots = { band: { content: "", revision: 0 }, box: { content: "", revision: 0 } };
		state.slots.set(inst, slots);
	}
	const slot = slots[surface];
	if (slot.content !== content) {
		slot.content = content;
		slot.revision++;
	}
	return { content, width: visibleWidth(content), revision: slot.revision };
}

/** Patch the statusline once per process; later calls only swap the renderer. */
export function installTakeover(renderer: Renderer): void {
	const state = takeoverState();
	state.renderer = renderer;
	if (state.originals) return;
	const proto = StatusLineComponent.prototype;
	const segment = SEGMENTS.session;
	const originals: Originals = {
		getSettings: statusLineHost.getSettings,
		updateSettings: proto.updateSettings,
		setComposerStyle: proto.setComposerStyle,
		setAutocompleteActiveProbe: proto.setAutocompleteActiveProbe,
		getTopBorder: proto.getTopBorder,
		getBandTopBorder: proto.getBandTopBorder,
		getStandaloneTopBorder: proto.getStandaloneTopBorder,
		renderBottomBar: proto.renderBottomBar,
		getPreviewLines: proto.getPreviewLines,
		render: proto.render,
		describeSession: segment.describe,
	};
	state.originals = originals;

	statusLineHost.getSettings = () => emptyLayout(originals.getSettings());

	proto.updateSettings = function (this: Proto, settings: StatusLineSettings): void {
		const s = takeoverState();
		s.userSettings.set(this, settings);
		originals.updateSettings.call(this, {
			...emptyLayout(settings),
			leftSegments: s.renderer?.requiredSegments() ?? ["session"],
		});
	};
	proto.setComposerStyle = function (this: Proto, style: ComposerStatusStyle): void {
		takeoverState().styles.set(this, style);
		originals.setComposerStyle.call(this, style);
	};
	proto.setAutocompleteActiveProbe = function (this: Proto, probe: (() => boolean) | undefined): void {
		const s = takeoverState();
		if (probe) s.autocomplete.set(this, probe);
		else s.autocomplete.delete(this);
		originals.setAutocompleteActiveProbe.call(this, probe);
	};
	segment.describe = (ctx: SegmentContext) => {
		const s = takeoverState();
		if (s.capture.active) s.capture.ctx = ctx;
		return originals.describeSession(ctx);
	};
	proto.getBandTopBorder = function (this: Proto, width: number): SlotResult {
		firstSight(this);
		return slotResult(this, "band", takeoverState().renderer?.slot(this, "band", width) ?? "");
	};
	proto.getTopBorder = function (this: Proto, width: number): SlotResult {
		firstSight(this);
		return slotResult(this, "box", takeoverState().renderer?.slot(this, "box", width) ?? "");
	};
	proto.getStandaloneTopBorder = function (this: Proto): SlotResult {
		firstSight(this);
		return { content: "", width: 0, revision: 0 };
	};
	proto.render = function (this: Proto, width: number): readonly string[] {
		firstSight(this);
		return takeoverState().renderer?.bottom(this, width) ?? [];
	};
	proto.renderBottomBar = function (this: Proto, width: number): string {
		firstSight(this);
		return takeoverState().renderer?.bottom(this, width).find(line => line !== "") ?? "";
	};
	proto.getPreviewLines = function (
		this: Proto,
		width: number,
		style?: Pick<ComposerStyle, "statusAttachment" | "bottomBar">,
	): string[] {
		firstSight(this);
		return takeoverState().renderer?.previewForStyle(this, width, style) ?? [];
	};
}

/**
 * The live SegmentContext of `inst`, captured through `describePreview()`.
 * Cached for the current synchronous frame.
 */
export function captureContext(inst: Proto): SegmentContext | undefined {
	const state = takeoverState();
	if (state.frameCtx?.inst === inst) return state.frameCtx.ctx;
	state.capture.active = true;
	state.capture.ctx = undefined;
	try {
		inst.describePreview();
	} catch (error) {
		logger.debug("statusliney: context capture failed", { error: String(error) });
	} finally {
		state.capture.active = false;
	}
	const ctx = state.capture.ctx;
	state.capture.ctx = undefined;
	state.frameCtx = { inst, ctx };
	queueMicrotask(() => {
		state.frameCtx = undefined;
	});
	return ctx;
}

/** Re-inject the required segments after the config changed. */
export function refreshInjection(): void {
	const state = takeoverState();
	const inst = state.lastInstance;
	if (!inst || !state.originals) return;
	inst.updateSettings(state.userSettings.get(inst) ?? realStatusLineSettings());
}

/** Empty the cached startup statusline so the next launch prepaints no built-in segments. */
export function scrubComposerCache(): void {
	try {
		const dbPath = getComposerCacheDbPath();
		if (!fs.existsSync(dbPath)) return;
		const db = new Database(dbPath);
		try {
			db.run("PRAGMA busy_timeout = 500");
			db.run(`UPDATE entries SET value = json_set(value,
				'$.statusLine.settings.preset', 'custom',
				'$.statusLine.settings.leftSegments', json('[]'),
				'$.statusLine.settings.rightSegments', json('[]'),
				'$.statusLine.settings.showHookStatus', json('false'))
				WHERE kind = 'status' AND json_valid(value) AND json_type(value, '$.statusLine.settings') = 'object'`);
		} finally {
			db.close();
		}
	} catch (error) {
		logger.debug("statusliney: composer cache scrub failed", { error: String(error) });
	}
}
