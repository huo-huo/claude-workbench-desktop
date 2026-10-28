## Why

当前项目浏览器的文件栏会过滤掉所有以 `.` 开头的隐藏文件与文件夹，导致 `.github`、`.vscode`、`.comet`、`.gitignore` 等配置项在工作台内不可见。同时双击文件只能调用系统默认应用打开，查看一个配置文件也要跳出工作台，打断当前的对话与终端上下文。工作台需要在不离开窗口的前提下查看文本文件内容。

## What Changes

- 文件栏显示以 `.` 开头的隐藏文件与文件夹；仍继续跳过 `.git`、`node_modules`、`dist`、`build`、`target` 等重型目录，避免文件树规模失控。
- 新增内置只读文本查看器：双击文本/代码文件时，在覆盖终端区域的面板中显示文件内容，提供文件名、相对路径、文件大小与关闭入口；关闭后回到原终端视图。
- 文件树双击默认行为改为「内置查看」；文件右键菜单新增「用系统默认应用打开」，保留原有的外部打开能力。
- 非文本类型（Word/PDF/图片/音视频等）、超过 1 MB、内容含二进制字节的文件不进入查看器，提示原因并保持原有的系统应用打开方式。
- 文件栏的刷新、搜索路径、拖拽与右键菜单等既有能力保持不变。

## Capabilities

### New Capabilities

- `workspace-file-browser`: 项目浏览器文件栏的展示范围（含隐藏条目与重型目录排除）以及内置只读文本查看器的打开、展示与关闭行为。

### Modified Capabilities

（无：现有 specs 中没有文件栏或文件查看相关能力，本次不修改其他能力的需求。）

## Impact

- 后端：`server/workspace/files.mjs` 的目录读取过滤逻辑；复用现有 `workspaceFileText()` 与 `GET /api/workspace/file`，不新增对外接口。
- 前端：`src/workspace/files.mjs` 的双击行为与右键菜单；`index.html` 增加终端区域的查看器面板；新增 `src/workspace/viewer.mjs` 负责内容加载与渲染；`src/workspace/state.mjs` 增加查看器状态字段。
- 样式：`src/workstation.css`（或现有工作区样式文件）增加查看器面板样式。
- 依赖：无新增第三方依赖，不改变现有终端、会话与文件树接口约定。
