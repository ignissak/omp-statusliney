import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import type { FrameRenderer } from "../frame";
import type { ConfigStore } from "../store";
import { MainView, type Nav, type View } from "./views";

/** Full-width overlay: live preview box, the current view, and its key hints. */
class SettingsOverlay implements Component {
	readonly #stack: View[] = [];
	readonly #nav: Nav;

	constructor(
		readonly tui: TUI,
		readonly theme: Theme,
		readonly store: ConfigStore,
		readonly renderer: FrameRenderer,
		readonly done: () => void,
	) {
		this.#nav = {
			store,
			theme,
			push: view => this.#stack.push(view),
			pop: () => {
				this.#stack.pop();
				if (this.#stack.length === 0) this.#close();
			},
			close: () => this.#close(),
		};
		this.#stack.push(new MainView(this.#nav));
	}

	#close(): void {
		this.store.setPreview(undefined);
		this.done();
	}

	#previewBox(width: number): string[] {
		const { theme } = this;
		const box = theme.boxRound;
		const inner = Math.max(0, width - 4);
		const title = " Preview ";
		const top = `${box.topLeft}${box.horizontal}${title}${box.horizontal.repeat(Math.max(0, width - 3 - visibleWidth(title)))}${box.topRight}`;
		const lines = this.renderer.previewLines(inner);
		const body = (lines.length > 0 ? lines : [theme.fg("dim", "(nothing visible)")]).map(line => {
			const fitted = truncateToWidth(line, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(fitted)));
			return `${theme.fg("border", box.vertical)} ${fitted}\x1b[0m${pad} ${theme.fg("border", box.vertical)}`;
		});
		const bottom = `${box.bottomLeft}${box.horizontal.repeat(Math.max(0, width - 2))}${box.bottomRight}`;
		return [theme.fg("border", top), ...body, theme.fg("border", bottom)];
	}

	render(width: number): readonly string[] {
		const view = this.#stack[this.#stack.length - 1];
		const out = [
			this.theme.fg("accent", this.theme.bold("statusliney settings")),
			...this.#previewBox(width),
			"",
			...(view?.render(width) ?? []),
			"",
			this.theme.fg("muted", view?.hint ?? ""),
		];
		return out.map(line => (visibleWidth(line) > width ? truncateToWidth(line, width) : line));
	}

	handleInput(data: string): void {
		this.#stack[this.#stack.length - 1]?.handleInput(data);
		this.tui.requestRender();
	}

	invalidate(): void {}

	dispose(): void {
		this.store.setPreview(undefined);
	}
}

export async function openSettings(ctx: ExtensionContext, store: ConfigStore, renderer: FrameRenderer): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => new SettingsOverlay(tui, theme, store, renderer, () => done(undefined)),
		{ overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "75%", margin: 0 } },
	);
	store.setPreview(undefined);
}
