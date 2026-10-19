import type { ExecOptions, ExecResult, ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent";
import type {
	ContextLineMode,
	SegmentContext,
	StatusLineComponent,
	StatusLinePreset,
	StatusLineSegmentOptions,
	StatusLineSeparatorStyle,
} from "@oh-my-pi/pi-tui/status-line";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import type { OptionValue, StatuslineyConfig, WidgetItem } from "../config";

export type WidgetCategory = "omp" | "git" | "context" | "session" | "environment" | "custom" | "layout";

/** Where a line is drawn: the band composer row, the box composer top border, or a plain row. */
export type Surface = "band" | "box" | "free";

export interface OptionDef {
	key: string;
	label: string;
	kind: "bool" | "enum" | "number" | "string";
	values?: readonly string[];
	min?: number;
	max?: number;
	default: OptionValue | "inherit";
}

/** The user's built-in `statusLine.*` display decisions, merged like `#computeEffectiveSettings`. */
export interface BuiltinPrefs {
	preset: StatusLinePreset;
	separator: StatusLineSeparatorStyle;
	transparent: boolean;
	sessionAccent: boolean;
	compactThinkingLevel: boolean;
	contextLine: ContextLineMode;
	showHookStatus: boolean;
	segmentOptions: StatusLineSegmentOptions;
}

/** Plugin-owned runtime state that widgets read. */
export interface PluginData {
	tools: { running?: string; last?: string };
	exec?: (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
	sessionManager?: ReadonlySessionManager;
	getConfig(): StatuslineyConfig;
}

export interface RenderEnv {
	ctx: SegmentContext;
	component: StatusLineComponent;
	theme: Theme;
	width: number;
	surface: Surface;
	builtin: BuiltinPrefs;
	data: PluginData;
	preview: boolean;
	requestRender: () => void;
	/** Set on lines whose context gauge absorbs the context segments as labels. */
	embedContext?: boolean;
}

export interface WidgetDef {
	type: string;
	name: string;
	description: string;
	category: WidgetCategory;
	kind: "content" | "flex" | "separator";
	options: readonly OptionDef[];
	/** null or "" hides the widget. */
	render(item: WidgetItem, env: RenderEnv): string | null;
	/** Flex widgets: fill exactly `width` cells. */
	renderFlex?(item: WidgetItem, env: RenderEnv, width: number): string;
	/** Flex widgets: minimum cells the fill needs on this line (default 1 between groups). */
	minFlexWidth?(item: WidgetItem, env: RenderEnv): number;
	/** Elastic widgets: re-render the raw content with a smaller length budget. */
	reshrink?(item: WidgetItem, env: RenderEnv, maxLength: number): string | null;
	elastic?: "path" | "title";
}
