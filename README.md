# dsh-typora-links

[![npm](https://img.shields.io/npm/v/dsh-typora-links.svg)](https://www.npmjs.com/package/dsh-typora-links)
[![test](https://github.com/Mengnan578/dsh-typora-links/actions/workflows/test.yml/badge.svg)](https://github.com/Mengnan578/dsh-typora-links/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/dsh-typora-links.svg)](./LICENSE)

Open Markdown file links from the [DeepSeek Harness](https://deepseek.com/harness/)
conversation in **Typora** instead of the in-app right-sidebar preview.

- **Plain click** on a local `.md` / `.markdown` link → Typora opens that file.
- **⌘ / Ctrl / Shift / Alt + click** → the shipped DSH preview (escape hatch).
- **Any failure** (missing file, host refusal, Typora unavailable) → falls back
  to the shipped preview; a click is never lost.
- HTTP links, non-Markdown files, the file tree, and the delivery cards keep
  their original behavior.

The plugin is macOS-only in practice (it looks for the macOS Typora bundle),
does not change the system default application, and adds no host route, no
shell command, and no file access of its own. It reuses DSH's authenticated
Session Remote for the native open.

## Requirements

- DeepSeek Harness Desktop (Web client) `>= 0.2.1-rc.2`
- macOS
- Typora installed (`/Applications/Typora.app`, bundle id `abnerworks.Typora`)

## Install

From npm (recommended):

```sh
dsh plugin --profile desktop add dsh-typora-links
```

From GitHub:

```sh
dsh plugin --profile desktop add github:Mengnan578/dsh-typora-links
```

From a local checkout, while developing:

```sh
dsh plugin --profile desktop add file:/path/to/dsh-typora-links
```

If the `dsh` command is not on `PATH`, install through the app's plugin manager
(**Settings → Plugins**) or edit `~/.dsh/profiles/desktop/package.json`
manually:

```jsonc
{
  "dependencies": {
    "dsh-typora-links": "link:/path/to/dsh-typora-links"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-typora-links"]
    }
  }
}
```

then run `pnpm install` in `~/.dsh/profiles/desktop` and restart DSH.

## Use

Click a Markdown link in the conversation, for example a file the agent just
wrote. Typora comes to the front with that file. Hold ⌘ (or Ctrl / Shift /
Alt) while clicking to keep the DSH preview.

Tool-row paths and `@file` mentions go through the same navigation entry, so
they open in Typora too. The file tree and delivery cards are untouched.

## Configuration

Optional, in the bundle row of `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: typora-links
  config:
    appName: Typora
    bundleId: abnerworks.Typora
    extensions: [".md", ".markdown"]
    gestureWindowMs: 900
    requireExplicitApp: false
```

| Field | Default | Meaning |
|---|---|---|
| `appName` | `Typora` | Display name to match in the file's macOS handlers. |
| `bundleId` | `abnerworks.Typora` | Bundle id to match; wins over the display name. |
| `extensions` | `[".md", ".markdown"]` | Files taken away from the preview. Extensions may omit the dot. |
| `gestureWindowMs` | `900` | How long after a click an open still counts as that click. |
| `requireExplicitApp` | `false` | When true, a file without a matching Typora handler falls back to the preview instead of the default application. |

When neither `appName` nor `bundleId` matches a handler, the plugin asks DSH to
open with the default application (which is Typora on a typical setup).

## How it works

```
pointerdown (capture) → remembers the gesture
conversation click → ctx.sidebarRight.openResource(address)
  → address is dsh-resource://file/session/<id>/<path>
  → remote.workspaceFiles.stat(sessionId, path)       → absolute path
  → remote.session.workspacePathApplications({path})  → Typora handler
  → remote.session.openWorkspacePath({path, application})
  → success: done; failure: original openResource (preview)
```

Tab-scoped navigation (`openResourceIn`) is a different method, so the file
tree, the tab strip, and the delivery cards are untouched.

## Security

- No host HTTP route, no command execution, no file reads or writes.
- The native open goes through DSH's authenticated Session Remote; the Host
  keeps validating path mapping and the application id.
- The plugin only affects browser behavior and is unloaded with its bundle.

## Limits

- Only paths the Host filesystem can map are opened; an absolute path outside
  the Session workspace may be refused by the Host and falls back to the
  preview.
- `dsh-resource://file/absolute/...` addresses (no session) are ignored.
- Depends on three internal DSH surfaces: `sidebarRight.openResource`,
  `workspaceFiles.stat`, and `session.openWorkspacePath` /
  `workspacePathApplications`. A DSH upgrade that changes them disables the
  plugin's behavior, but previews keep working.
- No Windows-specific launcher.

## Verify

```sh
node --test test/
```

In the browser console, a failed native open logs `[typora-links] ...` with the
reason. The plugin registers no settings page and no commands.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-typora-links
```

or remove the bundle from the profile and restart. Every behavior returns to
stock DSH.

## 中文说明

在 DSH 对话里**普通单击**本地的 `.md` / `.markdown` 链接，直接用 Typora 打开；
按住 ⌘ / Ctrl / Shift / Alt 点击仍走 DSH 自带的右侧预览；文件不存在、宿主拒绝或
Typora 打不开时自动回退预览，不会「点了没反应」。

```sh
dsh plugin --profile desktop add dsh-typora-links
```

仅在 macOS 验证；不修改系统默认应用，不新增宿主路由，不执行 shell。设置项见上方
Configuration 表格，默认即可用。

## License

MIT © 2026 Mengnan578
