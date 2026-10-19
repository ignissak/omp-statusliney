import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { normalizeConfig, type StatuslineyConfig, type WidgetItem } from "./config";

const SAVE_DEBOUNCE_MS = 200;
const WATCH_DEBOUNCE_MS = 150;

/** Owns the config file: load, debounced atomic save, external-edit watch, and a transient preview. */
export class ConfigStore {
	readonly warnings: string[] = [];
	#config: StatuslineyConfig;
	#preview: StatuslineyConfig | undefined;
	#readOnlyUntilEdit = false;
	#lastWritten: string | undefined;
	#saveTimer: NodeJS.Timeout | undefined;
	#watchTimer: NodeJS.Timeout | undefined;
	#watcher: fs.FSWatcher | undefined;
	#warnedInvalidWatch = false;
	#listeners = new Set<() => void>();

	constructor(
		readonly filePath: string,
		readonly fallbackLines: () => WidgetItem[][],
	) {
		this.#config = normalizeConfig({}, fallbackLines).config;
	}

	get readOnlyUntilEdit(): boolean {
		return this.#readOnlyUntilEdit;
	}

	load(): void {
		let text: string | undefined;
		try {
			text = fs.readFileSync(this.filePath, "utf8");
		} catch {
			text = undefined;
		}
		if (text === undefined) {
			this.#config = normalizeConfig({}, this.fallbackLines).config;
			this.#writeNow();
		} else {
			let raw: unknown;
			try {
				raw = JSON.parse(text);
			} catch {
				this.#readOnlyUntilEdit = true;
				this.#config = normalizeConfig({}, this.fallbackLines).config;
				this.warnings.push(
					`statusliney: ${this.filePath} is invalid JSON; using built-in layout until you edit settings`,
				);
				this.#watch();
				return;
			}
			const { config, warnings } = normalizeConfig(raw, this.fallbackLines);
			this.#config = config;
			this.warnings.push(...warnings);
			this.#lastWritten = text;
		}
		this.#watch();
	}

	get(): StatuslineyConfig {
		return this.#preview ?? this.#config;
	}

	/** The saved config, ignoring any preview. */
	saved(): StatuslineyConfig {
		return this.#config;
	}

	update(mutator: (config: StatuslineyConfig) => StatuslineyConfig): void {
		this.#config = mutator(structuredClone(this.#config));
		this.#readOnlyUntilEdit = false;
		this.#scheduleSave();
		this.#emit();
	}

	setPreview(config: StatuslineyConfig | undefined): void {
		if (config === undefined && this.#preview === undefined) return;
		this.#preview = config === undefined ? undefined : structuredClone(config);
		this.#emit();
	}

	onChange(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	dispose(): void {
		this.#watcher?.close();
		this.#watcher = undefined;
		clearTimeout(this.#watchTimer);
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = undefined;
			this.#writeNow();
		}
		this.#listeners.clear();
	}

	#emit(): void {
		for (const listener of this.#listeners) {
			try {
				listener();
			} catch (error) {
				logger.warn("statusliney: change listener failed", { error: String(error) });
			}
		}
	}

	#scheduleSave(): void {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = undefined;
			this.#writeNow();
		}, SAVE_DEBOUNCE_MS);
		this.#saveTimer.unref?.();
	}

	/** Atomic write: temp file then rename. Errors keep the in-memory state. */
	#writeNow(): void {
		if (this.#readOnlyUntilEdit) return;
		const text = `${JSON.stringify(this.#config, null, "\t")}\n`;
		try {
			fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
			const tmp = `${this.filePath}.tmp`;
			fs.writeFileSync(tmp, text);
			fs.renameSync(tmp, this.filePath);
			this.#lastWritten = text;
		} catch (error) {
			logger.warn("statusliney: config save failed", { path: this.filePath, error: String(error) });
		}
	}

	#watch(): void {
		if (this.#watcher) return;
		const dir = path.dirname(this.filePath);
		const base = path.basename(this.filePath);
		try {
			fs.mkdirSync(dir, { recursive: true });
			this.#watcher = fs.watch(dir, (_event, filename) => {
				if (filename !== base) return;
				clearTimeout(this.#watchTimer);
				this.#watchTimer = setTimeout(() => this.#reloadFromDisk(), WATCH_DEBOUNCE_MS);
				this.#watchTimer.unref?.();
			});
			this.#watcher.unref?.();
		} catch (error) {
			logger.debug("statusliney: config watch unavailable", { error: String(error) });
		}
	}

	#reloadFromDisk(): void {
		let text: string;
		try {
			text = fs.readFileSync(this.filePath, "utf8");
		} catch {
			return;
		}
		if (text === this.#lastWritten) return;
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			if (!this.#warnedInvalidWatch) {
				this.#warnedInvalidWatch = true;
				logger.warn("statusliney: ignoring invalid external config edit", { path: this.filePath });
			}
			return;
		}
		this.#lastWritten = text;
		this.#readOnlyUntilEdit = false;
		this.#config = normalizeConfig(raw, this.fallbackLines).config;
		this.#emit();
	}
}
