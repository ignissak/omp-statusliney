import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { logger, VERSION } from "@oh-my-pi/pi-utils";
import { defaultConfigPath } from "./config";
import { createFrameRenderer, type FrameRenderer } from "./frame";
import { mirrorBuiltinLines } from "./presets";
import { ConfigStore } from "./store";
import { canTakeOver, installTakeover, refreshInjection, scrubComposerCache, takeoverState } from "./takeover";
import { openSettings } from "./ui/settings";
import type { PluginData } from "./widgets/types";

const WIDGET_KEY = "statusliney";

function isInteractive(ctx: ExtensionContext): boolean {
	return ctx.hasUI && (ctx.mode === undefined || ctx.mode === "tui");
}

export default function statusliney(pi: ExtensionAPI): void {
	try {
		setup(pi);
	} catch (error) {
		logger.warn("statusliney: setup failed; built-in statusline kept", { error: String(error) });
	}
}

function setup(pi: ExtensionAPI): void {
	const store = new ConfigStore(defaultConfigPath(), mirrorBuiltinLines);
	store.load();
	scrubComposerCache();

	const data: PluginData = {
		tools: {},
		exec: (command, args, options) => pi.exec(command, args, options),
		getConfig: () => store.get(),
	};
	const supported = canTakeOver();
	const renderer: FrameRenderer = createFrameRenderer(store, data);
	// Extension factories are rebound to every subagent session; only the first load
	// installs the renderer here. The main interactive session claims it in `attach`.
	if (supported && !takeoverState().renderer) installTakeover(renderer);

	let ticker: NodeJS.Timeout | undefined;
	let tickerMs = 0;
	const stopTicker = (): void => {
		clearInterval(ticker);
		ticker = undefined;
		tickerMs = 0;
	};
	const startTicker = (): void => {
		const ms = store.get().refreshMs;
		if (ticker && tickerMs === ms) return;
		stopTicker();
		tickerMs = ms;
		ticker = setInterval(renderer.requestRender, ms);
		ticker.unref?.();
	};

	let notify: ((message: string) => void) | undefined;
	const flushWarnings = (): void => {
		if (!notify) return;
		for (const warning of store.takeWarnings()) notify(warning);
	};

	store.onChange(() => {
		flushWarnings();
		if (!supported) return;
		refreshInjection();
		if (ticker) startTicker();
		renderer.requestRender();
	});

	let warnedUnsupported = false;
	const attach = (ctx: ExtensionContext): void => {
		if (ctx.agent?.kind === "sub") return;
		data.sessionManager = ctx.sessionManager;
		if (!isInteractive(ctx)) return;
		notify = message => ctx.ui.notify(message, "warning");
		if (!supported) {
			if (!warnedUnsupported) {
				warnedUnsupported = true;
				notify(`statusliney: unsupported omp internals (${VERSION}); built-in statusline kept`);
			}
			return;
		}
		takeoverState().notify = notify;
		if (takeoverState().renderer !== renderer) {
			installTakeover(renderer);
			refreshInjection();
		}
		ctx.ui.setWidget(
			WIDGET_KEY,
			tui => {
				takeoverState().tui = tui;
				return { render: (width: number) => renderer.aboveLines(width), invalidate() {} };
			},
			{ placement: "aboveEditor" },
		);
		flushWarnings();
		startTicker();
	};

	pi.on("session_start", (_event, ctx) => attach(ctx));
	pi.on("session_switch", (_event, ctx) => attach(ctx));
	pi.on("tool_execution_start", event => {
		data.tools.running = event.toolName;
	});
	pi.on("tool_execution_end", event => {
		data.tools.running = undefined;
		data.tools.last = event.toolName;
	});
	pi.on("session_shutdown", () => {
		stopTicker();
		store.dispose();
	});

	pi.registerCommand("statusliney-settings", {
		description: "Configure the statusliney statusline (live preview, auto-saved)",
		handler: async (_args, ctx) => {
			if (!isInteractive(ctx)) {
				ctx.ui.notify("statusliney-settings needs the interactive TUI", "warning");
				return;
			}
			await openSettings(ctx, store, renderer);
		},
	});
}
