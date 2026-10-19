# omp-statusliney

A fully customizable statusline for [Oh My Pi](https://omp.sh) (`omp`). It replaces the built-in statusline completely, including the startup prepaint, and draws a multi-line bar like ccstatusline. It keeps all 27 built-in segments and adds 25 new widgets.

## Install

```sh
omp plugin install omp-statusliney
# or, from a checkout
omp plugin link /path/to/omp-statusliney
```

On first launch it writes `~/.omp/agent/statusliney.json` with a layout that copies your current built-in statusline, so nothing changes until you edit it. Uninstall the plugin to get the built-in bar back.

## Configure

Run `/statusliney-settings` in the TUI. Each change applies to the live bar right away and is saved automatically.

- **Lines & widgets**: 1–6 lines. Add (`a`), insert (`i`), delete (`d` twice), move (`[` `]`) and clone (`c`) widgets. Set each widget's color (theme tokens only), bold, label and options.
- **Appearance**: placement (`auto` puts the bar in the composer frame when it has one, otherwise below the prompt; or force `top`/`bottom`), separator (`inherit` follows `statusLine.separator`), background, hook status rows, refresh intervals.
- **Presets**: the built-in presets, `Two-line dev` and `Focused`. Moving through the list previews each preset on the live bar. Enter applies it; Esc restores your layout.
- **Reset to built-in layout**: copy your current built-in statusline settings again.

You can also edit the JSON by hand; the plugin picks up external edits while running. Set `OMP_STATUSLINEY_CONFIG` to use a different file.

The bar follows omp's theme and symbol preset (all glyphs and colors come from the theme). It also honors your `statusLine.*` preferences (segment options, transparent, session accent, compact thinking level, context line, hook status) and the composer shape.

## Widgets

| Category | Widgets |
|---|---|
| omp built-in | every built-in segment (`pi`, `model`, `path`, `git`, `pr`, `cost`, `context_pct`, `session_name`, `usage`, `vim`, …) |
| Git | `git_ahead_behind`, `git_sha`, `git_changes`, `git_stash`, `git_clean` |
| Context | `context_gauge` (the built-in context rule), `context_bar`, `context_remaining`, `quota_bar` |
| Session | `cost_rate`, `turns`, `compactions`, `session_clock`, `tool` |
| Environment | `jobs`, `thinking`, `provider`, `omp_version`, `terminal_width`, `memory` |
| Custom | `text`, `custom_command` (first output line, cached), `link` (OSC 8) |
| Layout | `separator`, `flex` |

## Compatibility

Requires omp `>=18.12.2 <19`. The plugin patches omp's internal statusline component. If an omp build lacks the members it needs, it leaves the built-in bar in place and shows a warning. Native TSP terminals (composer facts) are not affected.

## Development

```sh
bun install
bun test
bun run typecheck
```
