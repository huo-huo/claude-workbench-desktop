# 提案:优化项目与会话区域

## Why

对话工作站的项目与会话区域是使用频率最高的界面,但当前会话只能使用自动命名("文件夹 · 时间戳")、无法搜索过滤、不支持置顶归档和批量操作;项目与会话多了以后,定位历史会话效率低,分组与条目的层级视觉也不够清晰。本次集中优化该区域的管理能力与展示层级。

## What Changes

- 会话列表增加搜索框,按关键字过滤会话(匹配会话名/项目名/路径),清空后恢复完整列表
- 会话条目支持自定义重命名,覆盖自动命名;会话行展示最后活动时间等元信息
- 会话支持置顶:置顶会话在其项目分组内固定排在最前
- 会话支持归档:归档会话从主列表收起,可在归档区查看并恢复到主列表
- 会话支持批量选择与批量删除(活跃终端会话正确终止,保留 Claude 对话记录)
- 项目分组头与会话行的缩进层级优化,树形结构视觉更清晰
- 多会话/多项目场景下列表渲染与状态轮询保持流畅

## Capabilities

### New Capabilities

- `session-list-management`: 会话列表的管理能力——搜索过滤、自定义重命名与元信息展示、置顶与归档、批量选择与删除

### Modified Capabilities

- `session-project-grouping`: 组内排序规则从"按最近使用时间倒序"调整为"置顶优先,其余按最近使用时间倒序";新增分组标题与会话行之间的缩进层级展示要求

## Impact

- **前端**:`src/workspace/sessions.mjs`(列表渲染、过滤、分组、批量选择)、`src/workspace/activity.mjs`(会话行标记:重命名/元信息/缩进)、`src/workspace/preferences.mjs`(分组辅助)、`index.html`(搜索框、批量操作栏等控件)
- **后端**:`server/workspace/state.mjs`(`workspaceState` 会话条目新增自定义名称/置顶/归档字段及兼容回退)、`server/workspace/sessions.mjs`(列表接口返回归档过滤)、`server/routes/handlers.mjs`(重命名、置顶、归档、批量删除路由)
- **数据**:`~/.claude/workbench-workspace.json` 的 sessions 条目新增可选字段;旧数据缺省字段时回退现有行为,不需要迁移
- **依赖**:不引入新框架依赖
- **不受影响**:终端、文件树、输入区、状态栏、Claude 原始会话记录格式
