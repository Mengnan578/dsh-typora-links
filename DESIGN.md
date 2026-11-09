# dsh-typora-links — 产品设计

> 版本：v0.1（2026-11-09）
> 状态：设计定稿，进入实现

## 一句话

在 DSH 对话里**普通单击**指向本地 Markdown 文件的链接，用 **Typora** 打开，而不是在右侧栏预览。

## 背景与目标用户

用 DSH 写作、整理文档的人，产物通常落在工作区里的 `.md` 文件。DSH 的对话文件链接固定走右栏预览，想进 Typora 只能先预览、再点右上角「打开」，多一步且打断心流。

目标用户：macOS + DSH 桌面版 + Typora 已安装（本机已确认 Typora 是 `.md` 的默认程序）。

不改变 macOS 全局文件关联，不影响 Finder 双击，不碰 DSH 本体。

## 核心行为

| 用户动作 | 结果 |
|---|---|
| 普通单击对话里的 `.md` / `.markdown` 文件链接 | Typora 打开该文件；右栏**不**出现预览 |
| ⌘ / Ctrl / Shift / Alt + 单击同一链接 | DSH 原生预览（逃生口，保持原行为） |
| 单击 http(s) 链接、目录、非 Markdown 文件 | 完全不变 |
| 文件不存在 / 宿主拒绝 / Typora 打开失败 | 自动回退到 DSH 原生预览，不会「点了没反应」 |
| 会话恢复、其他插件、脚本触发的打开 | 不拦截（只认真实手势后 900ms 内的打开） |
| 右侧文件树、tab 内部导航、交付卡片 | 不变（它们走 `openResourceIn`，不经过本插件包裹的入口） |

## 功能清单（v1）

- **F1 手势识别**：`pointerdown` 捕获阶段记录；仅无修饰键、主键、900ms 内的一次打开会被接管，用过即失效。
- **F2 扩展名过滤**：默认 `.md` / `.markdown`，大小写不敏感，可配置。
- **F3 Typora 定向**：读取 macOS 对该文件的关联应用列表，按名称 / bundle id 找到 Typora，用显式 `application` 打开；找不到时退回系统默认程序（可配置为严格模式：找不到就回退预览）。
- **F4 失败回退**：解析、stat、关联查询、打开任一步失败，都调用原 `openResource`。
- **F5 零 UI、零轮询**：无设置页、无定时器；配置走 bundle 行 config。
- **F6 可选配置**：`appName`、`bundleId`、`extensions`、`gestureWindowMs`、`requireExplicitApp`。
- **F7 可诊断**：失败时 `console.warn('[typora-links] ...')`，不写日志文件。

## 非目标

- 不接管文件树 / 交付卡片 / 变更审查（已有 `dsh-open-native` 等插件负责）。
- 不做 DSH 内嵌 Markdown 编辑器。
- 不做 Windows 专用逻辑（代码平台中立，但只在 macOS 验证）。
- 不修改 macOS 默认应用关联，不写 LaunchServices。
- 不新增宿主 HTTP 路由，不 `spawn` 进程，不执行 shell。

## 交互细节

- 点击到 Typora 出现约 100–300ms 延迟（stat + 关联查询 + 打开 RPC）；首次关联查询可能更慢，之后按扩展名缓存。
- Typora 未运行 → 启动并打开；已运行 → 聚焦并打开该文件；该文件已打开 → 聚焦已有窗口。
- 打开失败 → 预览出现，Console 有原因；用户不会丢失这次点击。
- 同一个链接连点两次：第一次接管，第二次若超出窗口期则预览（不会开两个 Typora 窗口）。

## 技术方案

```
点击 → document pointerdown(捕获) 记录手势
     → chat 调用 ctx.sidebarRight.openResource(address)
     → 包裹层判断：手势 + .md + dsh-resource://file/session/...
     → remote.workspaceFiles.stat(sessionId, path)        拿绝对路径
     → remote.session.workspacePathApplications({path})  找 Typora 的 app id
     → remote.session.openWorkspacePath({path, application})
     → 成功：结束；失败：调用原 openResource（预览）
```

- 纯客户端插件，宿主半区为空 bundle 行（与 `dsh-open-native` 同构）。
- 复用 DSH 已认证的 Session Remote 与宿主路径映射校验，插件本身不新增攻击面。
- 依赖三个 DSH 内部接口：`sidebarRight.openResource`、`workspaceFiles.stat`、`session.openWorkspacePath` / `workspacePathApplications`。升级若改动，插件失效 = 回到预览，不会破坏界面。

## 安全

- 不新增网络端点；所有调用走 DSH 现有的已认证 RPC。
- 不执行命令，不读写文件内容，只把路径交给系统打开通道。
- 宿主侧仍会校验路径映射（工作区外路径可能被拒绝），插件不做绕过。

## 已知限制

- 只能打开宿主文件系统能映射的路径；工作区外的绝对路径可能被宿主拒绝，此时回退预览。
- `dsh-resource://file/absolute/...`（无 Session 归属）不处理。
- 仅验证 macOS；Typora 匹配默认用 macOS bundle id `abnerworks.Typora`。
- 依赖内部接口，DSH 升级后可能失效（优雅回退）。

## 验收标准

1. 单击对话里的 `foo.md` 链接 → Typora 打开该文件，右栏无新预览。
2. ⌘+单击同一链接 → 右栏预览，Typora 不打开。
3. 单击 http(s) 链接 → 原行为不变。
4. 单击不存在的 `.md` → 回退预览（显示错误），不弹 Typora。
5. 右侧文件树单击 `.md` → 仍然是预览。
6. 刷新页面 / 恢复会话 → 不自动弹 Typora。
7. Typora 未安装或不在关联列表 → 走系统默认程序；严格模式下回退预览。
8. 插件卸载 / 禁用 → 所有行为立即恢复原样。
