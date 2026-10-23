# Comet Design Handoff

- Change: global-theme-session-groups-folder-picker
- Phase: design
- Mode: compact
- Context hash: ba02149ae087f18710c1f21f9521b43bbd3695ed512b5853d5d7b078fdaaa049

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/global-theme-session-groups-folder-picker/proposal.md

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/proposal.md
- Lines: 1-30
- SHA256: 5d99cf7846eefc51f66fd5d6e137faa6a392cca913e1a72c918e54c89c27ab8e

```md
## Why

当前工作台有三处体验不一致：深色主题按钮藏在终端工具栏，只对对话工作站生效，管理页无法切换；会话列表把所有项目的会话平铺在一起，项目一多就难以查找；添加项目文件夹时弹出的是 Windows 旧式“浏览文件夹”树形对话框，与系统“打开”对话框的交互不一致。这些问题影响日常使用效率，适合在一次界面优化中集中解决。

## What Changes

- 将深色主题切换按钮从终端工具栏移到全局顶部栏，按钮对管理页和对话工作站都可见。
- 深浅主题作用于整个应用窗口，包括管理页各页面与工作站的侧栏、终端、文件栏；用户选择持久化到本机，重启后保持。
- 会话列表改为按项目目录分组展示，每个分组显示项目名称与路径，分组标题可点击折叠/展开，折叠状态持久化。
- 添加项目文件夹时改用系统“打开”式文件夹选择对话框（资源管理器风格），替代旧式“浏览文件夹”对话框。
- `/api/workspace/select-folder` 的请求与返回结构保持不变，仅替换对话框实现，前端调用方式不变。

## Capabilities

### New Capabilities

- `global-appearance-theme`: 全局深浅主题的切换入口、作用范围与持久化行为。
- `session-project-grouping`: 会话记录按项目目录分组展示及分组折叠状态的管理行为。
- `native-folder-picker`: 通过系统原生“打开”式对话框选择项目文件夹的行为。

### Modified Capabilities

无。项目尚无既有 specs，本次三个能力均为新增。

## Impact

- 前端：`index.html`（顶部栏按钮位置）、`src/workstation.js`（主题应用、会话分组渲染、折叠状态）、`src/workstation.css`（全局主题变量与分组样式）。
- 服务端：`server.mjs` 的 `selectWorkspaceFolder()` 对话框实现。
- 接口：`/api/workspace/select-folder` 契约不变；无会话数据结构变更。
- 依赖：不新增 npm 或 Rust 依赖，不改造 Tauri 外壳。

```

## docs/openspec/changes/global-theme-session-groups-folder-picker/design.md

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/design.md
- Lines: 1-96
- SHA256: 7e6d535673ab7600a99111bf6635c45fcd10692c7b6974babbf8a51866462106

[TRUNCATED]

```md
---
comet_change: global-theme-session-groups-folder-picker
role: technical-design
canonical_spec: openspec
---

## Context

- 应用由 Tauri 外壳启动本机 Node 服务，WebView 加载 `http://127.0.0.1:<port>/`；前端是 `index.html` + `src/workstation.js` + `src/workstation.css`，通过 HTTP 接口与 `server.mjs` 通信，不能直接使用 Tauri 的 IPC 与 dialog 插件。
- 主题现状：`workspaceDark` 由 localStorage key `claude-workbench-workspace-theme` 初始化；`applyWorkspaceTheme()` 只给 `.workspace` 加 `theme-dark`、给 `.shell` 加 `workspace-dark`，按钮位于终端工具栏，管理页不参与。
- 会话现状：`/api/workspace/sessions` 返回全部会话，包含 `projectPath`、`createdAt`、`lastUsedAt`、`mode`、`status`；前端 `refreshSessions()` 平铺渲染，`refreshSessionStatuses()` 依赖 `data-session-id` 更新状态。
- 选择器现状：`selectWorkspaceFolder()` 通过 PowerShell 使用 `System.Windows.Forms.FolderBrowserDialog`，结果以 UTF-8 Base64 输出，再由 `safeWorkspaceRoot()` 校验。

## Goals / Non-Goals

**Goals:**

- 主题状态成为应用级状态，管理页与对话工作站共用同一入口和同一套配色变量。
- 会话分组、折叠状态完全在前端完成，接口与数据结构不变。
- 文件夹选择使用系统现代“打开”式对话框，保持 `/api/workspace/select-folder` 契约不变。

**Non-Goals:**

- 不做多套强调色或用户自定义配色，只保留深色/浅色两种主题。
- 不改动会话存储格式、接口路径或服务端分组逻辑。
- 不改造 Tauri 外壳、不引入 Tauri dialog 插件或新依赖。
- 不调整管理页的信息架构与布局，仅做配色适配。

## Decisions

### 1. 主题状态提升到 `body` 级 class

将主题切换改为在 `document.body` 上设置 `theme-dark`，在 CSS 中用 `body.theme-dark` 覆盖应用级变量，并补充管理页现有硬编码颜色的覆盖规则。按钮移入顶部栏 `.top-actions`，管理页与工作区共用。

- 理由：顶部栏在两个视图中都可见，`body` 级作用域能覆盖管理页、侧栏、工作区和弹层，避免继续维护 `.workspace.theme-dark` 与 `.shell.workspace-dark` 两套互相依赖的开关。
- 替代方案：继续在 `.workspace`/`.shell` 上加 class。缺点是管理页与工作区的祖先链不同，覆盖范围难以完整，且视图切换时需要重复判断。

### 2. 终端配色跟随主题

`terminal.options.theme` 准备深色与浅色两套配色，主题切换时更新 xterm 实例的 theme，并在下一帧重新 `fit()`。

- 理由：满足“效果应用到整体”；终端是窗口里面积最大的区域，固定深色会破坏浅色主题的一致性。
- 替代方案：终端始终使用深色配色。实现更少，但与“整体主题”要求冲突。

### 3. 主题选择沿用现有 localStorage key

继续使用 `claude-workbench-workspace-theme`（值为 `dark` 或不存在），不新增服务端配置，也不迁移旧数据。

- 理由：已有用户选择可直接生效，避免迁移逻辑；主题属于本机显示偏好，不需要跨设备同步。

### 4. 会话分组在前端渲染层完成

以规范化后的 `projectPath`（统一斜杠、去除尾部斜杠、转小写）作为分组 key；分组标题显示项目名与完整路径，组内按 `lastUsedAt` 倒序；保留每个会话行现有的 `data-session-id`、`data-remove-session` DOM 约定，使 `refreshSessionStatuses()` 与移除逻辑无需重写。

折叠状态存入 localStorage key `claude-workbench-collapsed-projects`，值为规范化路径数组；分组标题使用可聚焦按钮并维护 `aria-expanded`。新项目默认展开；移除会话后重新拉取列表，空分组自然消失。

- 理由：接口已经返回 `projectPath`，后端无需改动；保持既有 DOM 约定可以把改动限制在渲染函数内。
- 替代方案：服务端新增分组接口。需要改接口与数据结构，收益仅为少一次前端分组，不划算。

### 5. 使用 IFileOpenDialog（FOS_PICKFOLDERS）实现“打开”式文件夹选择

在 `selectWorkspaceFolder()` 中通过 PowerShell 内联 C#（`Add-Type`）调用 COM `IFileOpenDialog`，设置 `FOS_PICKFOLDERS`，标题设为“打开”，取回结果后仍以 UTF-8 Base64 输出，交给现有 `safeWorkspaceRoot()` 校验。现代对话框启动失败时，回退到现有 `FolderBrowserDialog`，保证功能可用。

- 理由：前端无法使用 Tauri IPC，服务端调用 Windows 原生对话框是改动最小的路径；`FOS_PICKFOLDERS` 是资源管理器风格“选择文件夹”的标准实现。
- 替代方案 A：Tauri dialog 插件。需要把 WebView 改为本地协议页面并改造前端通信，超出本次范围。
- 替代方案 B：`OpenFileDialog` 搭配 `ValidateNames=false` 的技巧。无法可靠返回所选文件夹，放弃。

## Risks / Trade-offs

- [管理页存在硬编码颜色，深色覆盖可能遗漏] → 逐页检查 `index.html` 内联样式与 `workstation.css` 中的固定色值，在 `body.theme-dark` 作用域下补齐关键组件；验收时逐页切换检查。
- [xterm 主题切换后尺寸/重绘异常] → 切换主题后在同一帧调用 `fit()`，并通过实际终端会话验证。
- [折叠状态 key 因路径大小写或尾斜杠不一致而失效] → 统一用规范化函数生成分组 key，读写折叠状态都使用同一 key。
- [现代文件夹对话框在缺少 PowerShell/COM 的环境失败] → 捕获失败并回退旧式对话框；仍失败时返回明确错误提示。
- [localStorage 在多窗口实例间不同步] → 当前应用为单窗口模型，接受该限制；不做跨窗口同步。

## Migration Plan

无数据迁移。旧的主题 localStorage key 继续有效；折叠状态 key 为新增，缺省时全部展开。回滚时还原本次改动的前端与服务端文件即可，不涉及存量数据。

## 实现要点

```

Full source: docs/openspec/changes/global-theme-session-groups-folder-picker/design.md

## docs/openspec/changes/global-theme-session-groups-folder-picker/tasks.md

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/tasks.md
- Lines: 1-24
- SHA256: 5a162174ae1c48432fd9b3f43403201c511c1a7746406ca35fa057e0abdbd902

```md
## 1. 全局主题

- [x] 1.1 将主题切换按钮从终端工具栏移到顶部栏 `.top-actions`，管理页与对话工作站共用同一按钮；验证：两个视图下顶部栏都能看到按钮，终端工具栏不再有重复按钮。 <!-- comet-task:8d75b70f-8ee7-4c0a-bba3-9065e615205a -->
- [x] 1.2 在 `document.body` 上应用主题 class，并用 `body.theme-dark` 覆盖应用级 CSS 变量与关键硬编码颜色；验证：切换深色后逐页检查管理页各子页面、工作区侧栏、终端栏与文件栏，无残留浅色面板。 <!-- comet-task:55e08f54-3ffe-4630-b2bd-3505fd037766 -->
- [x] 1.3 为 xterm 准备深色与浅色两套 theme，主题切换时更新实例并在下一帧 `fit()`；验证：切换主题后终端背景与文字配色跟随变化，尺寸正常。 <!-- comet-task:a1ffb674-0a6c-438d-b116-06a0a3ae2781 -->
- [x] 1.4 沿用 `claude-workbench-workspace-theme` 持久化主题，启动时恢复；验证：选择深色后重新加载页面与应用，主题保持深色；清除该 key 后默认浅色。 <!-- comet-task:8d84ae17-e430-49f6-acfb-3a45fc86b69d -->
- [x] 1.5 维护主题按钮的 `aria-pressed` 与可访问名称；验证：按钮在深色/浅色下状态属性与文案一致。 <!-- comet-task:ac0f0eaa-2464-4e9a-b92b-021c632b634b -->

## 2. 会话按项目分组

- [x] 2.1 增加 projectPath 规范化函数（统一斜杠、去尾斜杠、转小写），按分组 key 聚合会话并渲染分组标题（项目名 + 路径），组内按 `lastUsedAt` 倒序；验证：构造两个项目的会话，分组正确且组内顺序符合最近使用时间。 <!-- comet-task:5ad6f49d-c136-45b5-aa71-ae44024ffbf3 -->
- [x] 2.2 分组标题支持点击折叠/展开，折叠状态写入 `claude-workbench-collapsed-projects`；验证：折叠后刷新页面与重开应用仍保持，新项目默认展开。 <!-- comet-task:25c4b01c-1606-40cd-af86-9ce60e3af1e9 -->
- [x] 2.3 保持会话行既有 `data-session-id`、`data-remove-session` 约定，使打开会话、移除会话和状态刷新继续工作；验证：分组内打开、移除会话正常，运行状态标记可更新，移除后空分组消失。 <!-- comet-task:686b8513-dcc1-4477-8bd1-76dbea6b05d7 -->

## 3. 系统“打开”式文件夹选择器

- [x] 3.1 在 `selectWorkspaceFolder()` 中用 PowerShell + COM `IFileOpenDialog`（`FOS_PICKFOLDERS`，标题“打开”）替换 `FolderBrowserDialog`，保留 Base64 UTF-8 输出与 `safeWorkspaceRoot()` 校验；验证：点击添加项目文件夹弹出资源管理器风格的选择窗口，确认按钮为“打开”。 <!-- comet-task:c8424226-73ec-456d-8a42-ca0e2c68147c -->
- [x] 3.2 现代对话框启动失败时回退旧式 `FolderBrowserDialog`，两者都失败时返回明确错误；验证：正常环境走现代对话框，模拟失败路径时回退或提示错误且应用不崩溃。 <!-- comet-task:d2056bec-bcbd-4313-ae03-3a3400dbb950 -->
- [x] 3.3 验证 `/api/workspace/select-folder` 契约不变：选择目录后项目加入列表并激活，取消后状态不变；验证：分别执行选择与取消，检查项目列表、当前项目与文件树刷新行为。 <!-- comet-task:0c198392-b0da-4fdf-aa91-b2bcebf6a3c7 -->

## 4. 集成验证

- [x] 4.1 运行 `npm run build`，验证构建成功且无报错。 <!-- comet-task:4bc5cb8e-c65d-4f1c-87ad-25d9abe3f047 -->
- [x] 4.2 启动 `npm run dev`（或 `npm run desktop:dev`），按三个能力逐项手工验收：全局主题与持久化、会话分组与折叠持久化、系统打开式文件夹选择器。 <!-- comet-task:9d7c1b98-a38a-44fd-b8a1-26156164de16 -->

```

## docs/openspec/changes/global-theme-session-groups-folder-picker/.openspec.yaml

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/.openspec.yaml
- Lines: 1-2
- SHA256: 0ad492a63d87e00a8bc135b0a1a2b19270dbb9ffd997a69b89fd4ab72015a944

```md
schema: spec-driven
created: 2026-10-22

```

## docs/openspec/changes/global-theme-session-groups-folder-picker/specs/global-appearance-theme/spec.md

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/specs/global-appearance-theme/spec.md
- Lines: 1-56
- SHA256: 7f0c1f92d6e3415c3c31321085faa63ccadbd1055d257081de007042f6b39b13

```md
## Purpose

让用户通过一个全局入口切换整个应用窗口的深色与浅色主题，并在下次启动时保持上次选择，避免管理页与对话工作站出现配色不一致。

## ADDED Requirements

### Requirement: 全局主题切换入口

应用 SHALL 在顶部栏提供一个主题切换按钮，该按钮在管理页和对话工作站视图中都可见，并通过文案与状态属性指示当前主题及可切换方向。

#### Scenario: 管理页可见主题按钮

- **WHEN** 用户进入管理页的任意子页面
- **THEN** 顶部栏显示主题切换按钮，按钮文案指示点击后切换到的主题（深色状态下显示浅色，反之显示深色）

#### Scenario: 工作区可见主题按钮

- **WHEN** 用户进入对话工作站视图
- **THEN** 顶部栏显示同一个主题切换按钮，终端工具栏不再重复提供该按钮

### Requirement: 主题作用于整个应用窗口

切换主题后，应用 SHALL 将深色或浅色配色应用到整个窗口，包括顶部栏、左侧导航、管理页内容、工作区侧栏、终端区域和文件栏。

#### Scenario: 切换到深色主题

- **WHEN** 用户点击顶部栏主题按钮从浅色切换到深色
- **THEN** 当前可见的管理页或工作区所有区域都使用深色配色，不出现局部仍为浅色的面板

#### Scenario: 切换回浅色主题

- **WHEN** 用户在深色状态下再次点击主题按钮
- **THEN** 整个窗口恢复为浅色配色

### Requirement: 主题选择持久化

应用 SHALL 将用户的主题选择保存在本机，应用重新启动后自动应用上次选择的主题。

#### Scenario: 重启后保持深色

- **WHEN** 用户选择深色主题后关闭并重新打开应用
- **THEN** 应用以深色主题启动，顶部栏按钮的 `aria-pressed` 为按下状态并显示可切换到浅色

#### Scenario: 首次使用默认浅色

- **WHEN** 本机没有保存过主题选择
- **THEN** 应用以浅色主题启动

### Requirement: 主题状态可被辅助技术识别

主题切换按钮 SHALL 通过 `aria-pressed` 等状态属性表达当前是否处于深色主题。

#### Scenario: 读取按钮状态

- **WHEN** 用户使用辅助技术聚焦主题按钮
- **THEN** 按钮的可访问名称与按下状态均能反映当前主题

```

## docs/openspec/changes/global-theme-session-groups-folder-picker/specs/native-folder-picker/spec.md

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/specs/native-folder-picker/spec.md
- Lines: 1-47
- SHA256: 9917fbf75654a3cf95c3e75bbc1b4f289a712d9fc72ac09788470f573c027d2d

```md
## Purpose

让用户通过系统原生“打开”式文件夹选择对话框添加项目目录，获得与 Windows 资源管理器一致的选择体验，替代旧式“浏览文件夹”树形对话框。

## ADDED Requirements

### Requirement: 使用系统原生文件夹选择对话框

点击添加项目文件夹时，应用 SHALL 打开 Windows 资源管理器风格的文件夹选择对话框，对话框以“打开”方式确认选择，而不是旧式“浏览文件夹”树形对话框。

#### Scenario: 打开添加项目文件夹对话框

- **WHEN** 用户点击“添加项目文件夹”按钮
- **THEN** 系统弹出资源管理器风格的文件夹选择窗口，支持地址栏导航、搜索和新建文件夹，确认按钮为“打开”

#### Scenario: 选择文件夹后添加项目

- **WHEN** 用户在对话框中选择一个文件夹并确认
- **THEN** 该文件夹被加入项目列表，并成为当前项目，文件树与会话列表随之刷新

#### Scenario: 取消选择

- **WHEN** 用户在对话框中取消或关闭窗口
- **THEN** 项目列表与当前项目保持不变，界面不显示错误

### Requirement: 失效路径与异常处理

当对话框无法打开或所选路径不可用时，应用 SHALL 给出明确的错误提示，并保持应用可用。

#### Scenario: 对话框启动失败

- **WHEN** 系统对话框无法启动
- **THEN** 界面提示无法打开文件夹选择窗口，应用其他功能不受影响

#### Scenario: 选择无效目录

- **WHEN** 用户选择的路径不在允许访问的范围内
- **THEN** 该路径不会被加入项目列表，界面给出提示

### Requirement: 选择接口契约保持不变

添加项目文件夹的调用 SHALL 保持现有请求与返回结构，前端不因对话框实现变化而修改调用方式。

#### Scenario: 前端调用无感知

- **WHEN** 前端发起添加项目文件夹请求
- **THEN** 返回结果仍包含所选项目路径字段，取消时返回空路径

```

## docs/openspec/changes/global-theme-session-groups-folder-picker/specs/session-project-grouping/spec.md

- Source: docs/openspec/changes/global-theme-session-groups-folder-picker/specs/session-project-grouping/spec.md
- Lines: 1-61
- SHA256: 1e15931e7d2c482412b3a15e576b7fe1bb9905117fd4225a2d7b1cb128790675

```md
## Purpose

让会话列表按所属项目目录分组展示，使用户在多个项目之间快速定位历史会话，并可按需折叠不关注的项目分组。

## ADDED Requirements

### Requirement: 会话按项目目录分组展示

会话列表 SHALL 按会话所属的项目目录分组，每个分组展示项目名称与目录路径，组内会话按最近使用时间倒序排列。

#### Scenario: 多个项目的会话分组

- **WHEN** 工作台中存在属于两个不同项目目录的会话
- **THEN** 会话列表显示两个项目分组，每个分组标题显示项目名称和路径，组内会话按最近使用时间从新到旧排列

#### Scenario: 同一项目的会话归入同一分组

- **WHEN** 同一项目目录下存在多个会话
- **THEN** 这些会话只出现在该项目的分组内，不会重复出现在其他分组

### Requirement: 项目分组可折叠

每个项目分组标题 SHALL 提供折叠与展开操作，折叠后组内会话隐藏，展开后恢复显示。

#### Scenario: 折叠项目分组

- **WHEN** 用户点击某个项目分组标题
- **THEN** 该分组内的会话被隐藏，分组标题仍可见并显示折叠状态

#### Scenario: 展开项目分组

- **WHEN** 用户再次点击已折叠的项目分组标题
- **THEN** 该分组内的会话重新显示

### Requirement: 折叠状态持久化

应用 SHALL 将各项目分组的折叠状态保存在本机，应用重新启动或重新加载会话列表后保持该状态。

#### Scenario: 重启后保持折叠

- **WHEN** 用户折叠某个项目分组后关闭并重新打开应用
- **THEN** 该项目分组仍处于折叠状态，其他分组状态不受影响

#### Scenario: 新项目默认展开

- **WHEN** 出现一个此前没有折叠记录的项目分组
- **THEN** 该分组默认展开

### Requirement: 分组展示不改变会话操作

分组后的会话条目 SHALL 保留原有操作，包括打开会话、移除会话和显示运行状态。

#### Scenario: 打开分组内会话

- **WHEN** 用户点击某个分组内的会话条目
- **THEN** 终端打开该会话，行为与分组前一致

#### Scenario: 移除分组内会话

- **WHEN** 用户点击某个分组内会话条目的移除按钮
- **THEN** 该会话从工作台移除，其所在分组在无剩余会话时一并消失

```
