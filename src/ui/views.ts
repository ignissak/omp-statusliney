import { getSelectListTheme, getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import {
	type Component,
	Input,
	matchesKey,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	truncateToWidth,
} from "@oh-my-pi/pi-tui";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import {
	BACKGROUND_CHOICES,
	GIT_REFRESH_RANGE,
	MAX_LINES,
	type OptionValue,
	PLACEMENTS,
	REFRESH_RANGE,
	SEPARATOR_CHOICES,
	type StatuslineyConfig,
	TRI_STATES,
	type WidgetItem,
} from "../config";
import { mirrorBuiltinLines, NAMED_PRESETS } from "../presets";
import type { ConfigStore } from "../store";
import { allWidgets, CATEGORY_NAMES, getWidget, WIDGET_COLOR_TOKENS } from "../widgets/registry";
import type { OptionDef } from "../widgets/types";

/** One screen of the settings stack. */
export interface View {
	readonly hint: string;
	render(width: number): readonly string[];
	handleInput(data: string): void;
}

/** What views use to move through the stack and mutate the config. */
export interface Nav {
	readonly store: ConfigStore;
	readonly theme: Theme;
	push(view: View): void;
	pop(): void;
	close(): void;
}

const LIST_ROWS = 12;

function isEscape(data: string): boolean {
	return matchesKey(data, "escape");
}

function isEnter(data: string): boolean {
	return matchesKey(data, "enter") || data === "\n";
}

/** Single-line text entry used as a SettingsList submenu. */
class InputSubmenu implements Component {
	readonly #input = new Input();

	constructor(
		readonly label: string,
		value: string,
		readonly done: (value?: string) => void,
		readonly theme: Theme,
	) {
		this.#input.setValue(value);
		this.#input.focused = true;
	}

	render(width: number): readonly string[] {
		return [
			this.theme.fg("muted", truncateToWidth(`${this.label} (enter saves, esc cancels)`, width)),
			...this.#input.render(width),
		];
	}

	handleInput(data: string): void {
		if (isEscape(data)) this.done(undefined);
		else if (isEnter(data)) this.done(this.#input.getValue());
		else this.#input.handleInput(data);
	}

	invalidate(): void {
		this.#input.invalidate();
	}
}

function inputSubmenu(label: string, nav: Nav): SettingItem["submenu"] {
	return (current, done) => new InputSubmenu(label, current, done, nav.theme);
}

/** Parse an integer in range; undefined when invalid. */
function parseIntInRange(text: string, min: number, max: number): number | undefined {
	if (!/^-?\d+$/.test(text.trim())) return undefined;
	const value = Number(text.trim());
	return value >= min && value <= max ? value : undefined;
}

/** A plain cursor list with custom key handling (lines and line editor). */
abstract class CursorList implements View {
	abstract readonly hint: string;
	protected selected = 0;
	/** Index armed by a first destructive key press. */
	protected armed: { key: string; index: number } | undefined;

	constructor(protected readonly nav: Nav) {}

	protected abstract rows(): string[];
	protected abstract emptyText(): string;
	protected abstract onKey(data: string): boolean;

	render(width: number): readonly string[] {
		const rows = this.rows();
		if (rows.length === 0) return [this.nav.theme.fg("muted", truncateToWidth(this.emptyText(), width))];
		this.selected = Math.min(this.selected, rows.length - 1);
		const start = Math.max(0, Math.min(this.selected - Math.floor(LIST_ROWS / 2), rows.length - LIST_ROWS));
		return rows.slice(start, start + LIST_ROWS).map((row, offset) => {
			const index = start + offset;
			const prefix = index === this.selected ? this.nav.theme.fg("accent", "› ") : "  ";
			return truncateToWidth(prefix + row, width);
		});
	}

	/** True when this key press confirms an armed action. */
	protected confirm(key: string): boolean {
		if (this.armed?.key === key && this.armed.index === this.selected) {
			this.armed = undefined;
			return true;
		}
		this.armed = { key, index: this.selected };
		return false;
	}

	handleInput(data: string): void {
		const count = this.rows().length;
		const previousArm = this.armed;
		if (isEscape(data)) {
			this.nav.pop();
			return;
		}
		if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down")) this.selected = Math.min(Math.max(0, count - 1), this.selected + 1);
		else if (!this.onKey(data)) return;
		if (this.armed === previousArm) this.armed = undefined;
	}
}

function moveItem<T>(list: T[], from: number, to: number): boolean {
	if (to < 0 || to >= list.length || from === to) return false;
	const [entry] = list.splice(from, 1);
	list.splice(to, 0, entry);
	return true;
}

export class LinesView extends CursorList {
	readonly hint = "↑↓ select · enter edit · a add · d delete (twice) · [ ] move · esc back";

	protected emptyText(): string {
		return "(no lines)";
	}

	protected rows(): string[] {
		return this.nav.store.saved().lines.map((line, index) => {
			const marker = this.armed?.key === "d" && this.armed.index === index;
			const detail = line.length === 0 ? "empty" : `${line.length} widget${line.length === 1 ? "" : "s"}`;
			const text = `Line ${index + 1} · ${detail}`;
			return marker ? `${text} ${this.nav.theme.fg("warning", "press d again to delete")}` : text;
		});
	}

	protected onKey(data: string): boolean {
		const { store } = this.nav;
		const index = this.selected;
		const count = store.saved().lines.length;
		if (isEnter(data)) {
			if (count > 0) this.nav.push(new LineEditorView(this.nav, index));
		} else if (data === "a") {
			if (count >= MAX_LINES) return true;
			store.update(c => {
				c.lines.splice(index + 1, 0, []);
				return c;
			});
			this.selected = index + 1;
		} else if (data === "d") {
			if (count <= 1 || !this.confirm("d")) return true;
			store.update(c => {
				c.lines.splice(index, 1);
				return c;
			});
		} else if (data === "[" || data === "]") {
			const to = data === "[" ? index - 1 : index + 1;
			if (to < 0 || to >= count) return true;
			store.update(c => {
				moveItem(c.lines, index, to);
				return c;
			});
			this.selected = to;
		}
		return true;
	}
}

function describeItem(item: WidgetItem, theme: Theme): string {
	const def = getWidget(item.type);
	const modifiers: string[] = [];
	if (item.color) modifiers.push(item.color);
	if (item.bold) modifiers.push("bold");
	if (item.label) modifiers.push(`label "${item.label}"`);
	for (const [key, value] of Object.entries(item.options ?? {})) modifiers.push(`${key}=${String(value)}`);
	const name = def ? `${CATEGORY_NAMES[def.category]} › ${def.name}` : item.type;
	return modifiers.length > 0 ? `${name} ${theme.fg("muted", `(${modifiers.join(", ")})`)}` : name;
}

export class LineEditorView extends CursorList {
	readonly hint = "↑↓ select · enter edit · a add after · i insert before · d delete (twice) · [ ] move · c clone · esc back";

	constructor(
		nav: Nav,
		readonly lineIndex: number,
	) {
		super(nav);
	}

	#line(): WidgetItem[] {
		return this.nav.store.saved().lines[this.lineIndex] ?? [];
	}

	protected emptyText(): string {
		return "(empty — press a to add a widget)";
	}

	protected rows(): string[] {
		return this.#line().map((item, index) => {
			const text = describeItem(item, this.nav.theme);
			const marker = this.armed?.key === "d" && this.armed.index === index;
			return marker ? `${text} ${this.nav.theme.fg("warning", "press d again to delete")}` : text;
		});
	}

	#mutate(mutator: (line: WidgetItem[]) => void): void {
		this.nav.store.update(c => {
			const line = c.lines[this.lineIndex];
			if (line) mutator(line);
			return c;
		});
	}

	#pick(at: number): void {
		this.nav.push(
			new PickerView(this.nav, type => {
				const item: WidgetItem = { id: crypto.randomUUID(), type };
				this.#mutate(line => line.splice(at, 0, item));
				this.selected = at;
				this.nav.pop();
				this.nav.push(new WidgetEditorView(this.nav, this.lineIndex, item.id));
			}),
		);
	}

	protected onKey(data: string): boolean {
		const line = this.#line();
		const index = this.selected;
		const current = line[index];
		if (isEnter(data)) {
			if (current) this.nav.push(new WidgetEditorView(this.nav, this.lineIndex, current.id));
		} else if (data === "a") {
			this.#pick(line.length === 0 ? 0 : index + 1);
		} else if (data === "i") {
			this.#pick(index);
		} else if (data === "d") {
			if (!current || !this.confirm("d")) return true;
			this.#mutate(items => items.splice(index, 1));
		} else if (data === "[" || data === "]") {
			const to = data === "[" ? index - 1 : index + 1;
			if (to < 0 || to >= line.length) return true;
			this.#mutate(items => moveItem(items, index, to));
			this.selected = to;
		} else if (data === "c") {
			if (!current) return true;
			this.#mutate(items => items.splice(index + 1, 0, { ...structuredClone(current), id: crypto.randomUUID() }));
			this.selected = index + 1;
		}
		return true;
	}
}

export class PickerView implements View {
	readonly hint = "type to filter · ↑↓ select · enter add · esc back";
	readonly #list: SelectList;

	constructor(nav: Nav, onPick: (type: string) => void) {
		const items: SelectItem[] = allWidgets().map(def => ({
			value: def.type,
			label: `${CATEGORY_NAMES[def.category]} › ${def.name}`,
			description: def.description,
		}));
		this.#list = new SelectList(items, LIST_ROWS, getSelectListTheme(), { search: "always" });
		this.#list.onSelect = item => onPick(item.value);
		this.#list.onCancel = () => nav.pop();
	}

	render(width: number): readonly string[] {
		return this.#list.render(width);
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}
}

const BOOL_LABEL = (value: OptionValue | undefined, inheritable: boolean): string => {
	if (value === undefined) return inheritable ? "inherit" : "off";
	return value === true ? "on" : "off";
};

function optionDisplay(def: OptionDef, value: OptionValue | undefined): string {
	if (def.kind === "bool") {
		if (value === undefined) return def.default === "inherit" ? "inherit" : def.default === true ? "on" : "off";
		return BOOL_LABEL(value, def.default === "inherit");
	}
	return String(value ?? def.default);
}

export class WidgetEditorView implements View {
	readonly hint = "↑↓ select · enter change · esc back";
	readonly #list: SettingsList;

	constructor(
		readonly nav: Nav,
		readonly lineIndex: number,
		readonly itemId: string,
	) {
		const item = this.#item();
		const def = item ? getWidget(item.type) : undefined;
		const settingItems: SettingItem[] = [
			{ id: "color", label: "Color", currentValue: item?.color ?? "default", values: ["default", ...WIDGET_COLOR_TOKENS] },
			{ id: "bold", label: "Bold", currentValue: item?.bold ? "on" : "off", values: ["off", "on"] },
			{
				id: "label",
				label: "Label",
				description: "Text shown before the widget; empty clears",
				currentValue: item?.label ?? "",
				submenu: inputSubmenu("Label", nav),
			},
		];
		for (const option of def?.options ?? []) {
			const value = item?.options?.[option.key];
			const entry: SettingItem = { id: `opt:${option.key}`, label: option.label, currentValue: optionDisplay(option, value) };
			if (option.kind === "bool") {
				entry.values = option.default === "inherit" ? ["inherit", "on", "off"] : ["on", "off"];
			} else if (option.kind === "enum") {
				entry.values = [...(option.default === "inherit" ? ["inherit"] : []), ...(option.values ?? [])];
			} else {
				entry.submenu = inputSubmenu(option.label, nav);
				if (option.kind === "number") entry.description = `Integer ${option.min ?? ""}..${option.max ?? ""}`;
			}
			settingItems.push(entry);
		}
		const list = new SettingsList(
			settingItems,
			LIST_ROWS,
			getSettingsListTheme(),
			(id, value) => this.#apply(settingItems, id, value),
			() => nav.pop(),
			{ hint: "", typeToSearch: false },
		);
		this.#list = list;
	}

	#item(): WidgetItem | undefined {
		return this.nav.store.saved().lines[this.lineIndex]?.find(item => item.id === this.itemId);
	}

	#apply(items: SettingItem[], id: string, value: string): void {
		const row = items.find(entry => entry.id === id);
		const item = this.#item();
		const def = item ? getWidget(item.type) : undefined;
		if (!row || !item || !def) return;
		let next: Partial<WidgetItem> & { options?: Record<string, OptionValue> } = {};
		if (id === "color") {
			next = { color: value === "default" ? undefined : WIDGET_COLOR_TOKENS.find(token => token === value) };
		} else if (id === "bold") {
			next = { bold: value === "on" ? true : undefined };
		} else if (id === "label") {
			next = { label: value === "" ? undefined : value };
		} else if (id.startsWith("opt:")) {
			const option = def.options.find(candidate => `opt:${candidate.key}` === id);
			if (!option) return;
			const options = { ...item.options };
			if (value === "inherit") {
				delete options[option.key];
			} else if (option.kind === "bool") {
				options[option.key] = value === "on";
			} else if (option.kind === "number") {
				const parsed = parseIntInRange(value, option.min ?? Number.MIN_SAFE_INTEGER, option.max ?? Number.MAX_SAFE_INTEGER);
				if (parsed === undefined) {
					row.warning = `Invalid: enter an integer ${option.min}..${option.max}`;
					this.#list.updateValue(id, optionDisplay(option, item.options?.[option.key]));
					return;
				}
				options[option.key] = parsed;
			} else {
				options[option.key] = value;
			}
			row.warning = undefined;
			next = { options: Object.keys(options).length > 0 ? options : undefined };
		}
		this.nav.store.update(c => {
			const target = c.lines[this.lineIndex]?.find(entry => entry.id === this.itemId);
			if (!target) return c;
			for (const [key, val] of Object.entries(next)) {
				if (val === undefined) delete target[key as keyof WidgetItem];
				else Object.assign(target, { [key]: val });
			}
			return c;
		});
	}

	render(width: number): readonly string[] {
		const item = this.#item();
		const def = item ? getWidget(item.type) : undefined;
		const title = def ? `${CATEGORY_NAMES[def.category]} › ${def.name}` : "Widget";
		return [this.nav.theme.fg("accent", truncateToWidth(title, width)), ...this.#list.render(width)];
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}
}

export class AppearanceView implements View {
	readonly hint = "↑↓ select · enter change · esc back";
	readonly #list: SettingsList;

	constructor(readonly nav: Nav) {
		const config = nav.store.saved();
		const items: SettingItem[] = [
			{
				id: "placement",
				label: "Placement",
				description: "auto: in the composer frame when it has one, else below the prompt",
				currentValue: config.placement,
				values: [...PLACEMENTS],
			},
			{ id: "separator", label: "Separator", currentValue: config.separator, values: [...SEPARATOR_CHOICES] },
			{ id: "background", label: "Background", currentValue: config.background, values: [...BACKGROUND_CHOICES] },
			{
				id: "hookStatusRows",
				label: "Hook status rows",
				description: "Extension status rows under the bar (inherit = statusLine.showHookStatus)",
				currentValue: config.hookStatusRows,
				values: [...TRI_STATES],
			},
			{
				id: "refreshMs",
				label: "Refresh (ms)",
				description: `Integer ${REFRESH_RANGE.min}..${REFRESH_RANGE.max}`,
				currentValue: String(config.refreshMs),
				submenu: inputSubmenu("Refresh (ms)", nav),
			},
			{
				id: "gitRefreshMs",
				label: "Git refresh (ms)",
				description: `Integer ${GIT_REFRESH_RANGE.min}..${GIT_REFRESH_RANGE.max}`,
				currentValue: String(config.gitRefreshMs),
				submenu: inputSubmenu("Git refresh (ms)", nav),
			},
		];
		this.#list = new SettingsList(
			items,
			LIST_ROWS,
			getSettingsListTheme(),
			(id, value) => this.#apply(items, id, value),
			() => nav.pop(),
			{ hint: "", typeToSearch: false },
		);
	}

	#apply(items: SettingItem[], id: string, value: string): void {
		const row = items.find(entry => entry.id === id);
		if (!row) return;
		const update = (mutator: (c: StatuslineyConfig) => void) =>
			this.nav.store.update(c => {
				mutator(c);
				return c;
			});
		if (id === "refreshMs" || id === "gitRefreshMs") {
			const range = id === "refreshMs" ? REFRESH_RANGE : GIT_REFRESH_RANGE;
			const parsed = parseIntInRange(value, range.min, range.max);
			if (parsed === undefined) {
				row.warning = `Invalid: enter an integer ${range.min}..${range.max}`;
				this.#list.updateValue(id, String(this.nav.store.saved()[id]));
				return;
			}
			row.warning = undefined;
			update(c => {
				c[id] = parsed;
			});
			return;
		}
		update(c => {
			if (id === "placement") c.placement = PLACEMENTS.find(v => v === value) ?? c.placement;
			else if (id === "separator") c.separator = SEPARATOR_CHOICES.find(v => v === value) ?? c.separator;
			else if (id === "background") c.background = BACKGROUND_CHOICES.find(v => v === value) ?? c.background;
			else if (id === "hookStatusRows") c.hookStatusRows = TRI_STATES.find(v => v === value) ?? c.hookStatusRows;
		});
	}

	render(width: number): readonly string[] {
		return this.#list.render(width);
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}
}

export class PresetsView implements View {
	readonly hint = "↑↓ preview on the live bar · enter apply · esc cancel";
	readonly #list: SelectList;
	readonly #lines = new Map<string, WidgetItem[][]>();

	constructor(readonly nav: Nav) {
		const items: SelectItem[] = NAMED_PRESETS.map(preset => ({ value: preset.id, label: preset.label }));
		this.#list = new SelectList(items, LIST_ROWS, getSelectListTheme(), { search: "never" });
		this.#list.onSelectionChange = item => this.#preview(item.value);
		this.#list.onSelect = item => {
			const lines = this.#presetLines(item.value);
			if (lines) {
				nav.store.update(c => ({ ...c, lines: structuredClone(lines) }));
			}
			nav.store.setPreview(undefined);
			nav.pop();
		};
		this.#list.onCancel = () => {
			nav.store.setPreview(undefined);
			nav.pop();
		};
		const first = items[0];
		if (first) this.#preview(first.value);
	}

	#presetLines(id: string): WidgetItem[][] | undefined {
		let lines = this.#lines.get(id);
		if (!lines) {
			lines = NAMED_PRESETS.find(preset => preset.id === id)?.lines();
			if (lines) this.#lines.set(id, lines);
		}
		return lines;
	}

	#preview(id: string): void {
		const lines = this.#presetLines(id);
		if (lines) this.nav.store.setPreview({ ...this.nav.store.saved(), lines });
	}

	render(width: number): readonly string[] {
		return this.#list.render(width);
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}
}

const RESET_LABEL = "Reset to built-in layout";
const RESET_CONFIRM = "Press Enter again to reset";

export class MainView implements View {
	readonly hint = "↑↓ select · enter open · esc close";
	readonly #list: SelectList;
	#armed = false;

	constructor(readonly nav: Nav) {
		this.#list = new SelectList(this.#items(), LIST_ROWS, getSelectListTheme(), { search: "never" });
		this.#list.onSelectionChange = item => {
			if (item.value !== "reset" && this.#armed) this.#setArmed(false);
		};
		this.#list.onCancel = () => nav.close();
		this.#list.onSelect = item => {
			switch (item.value) {
				case "lines":
					nav.push(new LinesView(nav));
					break;
				case "appearance":
					nav.push(new AppearanceView(nav));
					break;
				case "presets":
					nav.push(new PresetsView(nav));
					break;
				case "reset":
					if (!this.#armed) {
						this.#setArmed(true);
						break;
					}
					this.#setArmed(false);
					nav.store.update(c => ({ ...c, lines: mirrorBuiltinLines(), separator: "inherit" }));
					break;
				case "close":
					nav.close();
					break;
			}
		};
	}

	#items(): SelectItem[] {
		return [
			{ value: "lines", label: "Lines & widgets", description: "Add, remove, reorder and style widgets" },
			{ value: "appearance", label: "Appearance", description: "Placement, separator, background, refresh" },
			{ value: "presets", label: "Presets", description: "Browse layouts with a live preview" },
			{
				value: "reset",
				label: this.#armed ? RESET_CONFIRM : RESET_LABEL,
				description: "Mirror the built-in statusline settings",
			},
			{ value: "close", label: "Close" },
		];
	}

	#setArmed(armed: boolean): void {
		this.#armed = armed;
		const selected = this.#list.getSelectedItem()?.value;
		this.#list.setItems(this.#items());
		if (selected) this.#list.setSelectedValue(selected);
	}

	render(width: number): readonly string[] {
		return this.#list.render(width);
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}
}
