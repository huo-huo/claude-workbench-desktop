---
comet_change: optimize-workspace-sessions
role: technical-design
canonical_spec: openspec
archived-with: 2026-10-27-optimize-workspace-sessions
status: final
---

# 设计:优化项目与会话区域

## Context

会话列表由后端 `server/workspace/state.mjs`(`workbench-workspace.json` 持久化,`workspaceState()` 读取时自动补齐会话命名)+ `server/workspace/sessions.mjs`(列表/移除接口)支撑;前端 `src/workspace/sessions.mjs` 按项目分组渲染(`groupSessionsByProject`),`src/workspace/activity.mjs` 生成会话行,3 秒轮询只更新状态标记不重建行。路由注册在 `server/routes/handlers.mjs`。数据条目现有字段:`id/projectPath/name/mode/createdAt/lastUsedAt`。相关约束:项目记忆沉淀的 pty 环境剥离与 worktree 启动变量覆盖经验在验证时适用;`atomicJson` 已保证文件原子写入。

## Goals / Non-Goals

**Goals:**

- 会话数据条目增加可选字段 `customName`、`pinned`、`archived`,旧数据缺省时回退现有行为,零迁移
- 搜索过滤、重命名、置顶、归档、批量删除五项能力,路由与列表接口同步扩展
- 分组内排序改为置顶优先;分组标题与会话行缩进层级清晰
- 批量操作期间轮询不清除勾选状态

**Non-Goals:**

- 不改动终端、文件树、输入区、状态栏
- 不修改 Claude 原始对话记录与 `~/.claude/projects` 结构
- 不引入新依赖;不做跨设备同步

## Decisions

1. **重命名存独立字段 `customName`,不改写 `name`**——`workspaceState()` 的自动命名逻辑保留 `name` 为自动名,显示时取 `customName` 非空优先。备选:直接写 `name`,被否决:无法区分自定义名与自动名,清空回退自动命名无法实现,且会被既有占位名重写逻辑干扰。
2. **置顶/归档用布尔字段 `pinned`/`archived`**——排序在服务端 `listWorkspaceSessions` 完成(置顶优先,组内 `lastUsedAt` 倒序,与现行为一致);主列表默认过滤 `archived`,归档区经查询参数获取。备选:前端排序,被否决:排序规则属于数据语义,放后端与既有排序位置一致。
3. **搜索为纯前端过滤**——列表数据本就全量返回,内存过滤即可,无后端改动。过滤作用于会话名(customName 优先)+ 项目名,空分组隐藏。
4. **批量删除走单一后端接口 `POST /api/workspace/sessions/remove-batch`**——服务端循环复用现有 `removeWorkspaceSession` 的终止逻辑(Ctrl+C → 延时 kill),逐个执行并汇总结果;部分失败不回滚。备选:前端循环调单个移除接口,被否决:多次往返、中途失败状态难汇报。
5. **重命名/置顶/归档各走一个小路由**(`session/rename`、`session/pin`、`session/archive`),均只更新对应字段后原子写回——与现有 `session/remove` 的单条目风格一致,不做通用 PATCH 以保持风格简单。
6. **归档区为列表面板而非独立视图**——在会话区域头部入口打开归档面板展示归档会话(恢复/彻底移除),避免新增视图路由。
7. **勾选状态存前端 `app.bulkSelected`(Set),全量重绘后恢复**——3 秒轮询(`refreshSessionStatuses`)只更新状态标记,天然不清勾选;`refreshSessions` 全量重建后按 Set 恢复勾选。
8. **缩进层级用 CSS 缩进(会话行相对分组头缩进)+ 调整行内信息层级**——纯样式改动,不改 DOM 结构关系。

以上 8 项为 Open 阶段初稿决策,经 brainstorming 审查后维持;以下 3 项为 Design 阶段确认的增补(brainstorming 检查点见 `.comet/handoff/brainstorm-summary.md`):

9. **归档在线会话先终止终端再归档**——复用移除逻辑的 Ctrl+C → 延时 kill;与移除的区别是条目保留、可从归档区恢复。理由:不定义该行为会留下"列表不可见但终端仍在运行"的失控进程。备选:拒绝归档在线会话,被否决:操作被无谓拒绝,交互生硬。
10. **批量删除执行前弹确认(提示数量),结果 toast 汇总(成功 n / 失败 m)**——破坏性操作常规防护;失败项保留在列表,不回滚。
11. **勾选与过滤共存:批量删除作用于全部勾选项,与当前过滤无关**——勾选是显式动作;操作后清空勾选并刷新。

用户验收阶段增补(verify-fail 回 build):

12. **管理操作收进"⋯"入口**——"批量管理"与"查看归档"收进列表头"⋯"更多菜单,点击展开、点击项执行并收起、点击外部关闭(参考既有 fileTreeContextMenu 交互);搜索框与刷新保持常显(高频)。理由:窄侧栏常显按钮过多导致拥挤与重叠,管理是低频操作。
13. **删除操作统一二次确认**——单条移除与归档面板彻底移除补 confirm(文案说明 Claude 记录保留),与批量删除既有确认语义一致。

用户验收阶段增补(第二轮 verify-fail 后):

14. **移除「继续上次对话」按钮与会话行创建方式标签**——用户判定:点击已有会话本身就是继续,头部按钮冗余;会话行第二行只保留最后活动时间,右侧"会话在线/已结束"状态保留。后端 `mode=continue` 仍保留,仅作为无 CLI 会话 ID 旧会话点开时的兜底(`openSavedSession`),因此不删除 `--continue` 分支与 statusline 的兜底匹配逻辑。

## 测试策略

- **后端**:新增 `tests/workspace-state.test.mjs`(customName 回退、旧数据兼容、pinned 排序、archived 过滤、rename/pin/archive 原子写回);扩展 `tests/server-routes.test.mjs`(三个新路由、remove-batch 含不存在 id 与在线会话路径)
- **前端**:项目无前端自动化测试基建,按 specs 验收场景手工走查,不为凑数新增测试框架
- **集成**:`node --test tests/` 全量通过 + 端到端验收场景走查(对照 specs 逐条记录)

## Risks / Trade-offs

- [旧数据无新字段] → 全部按缺省值处理(无 customName 显自动名、未置顶、未归档),`workspaceState()` 读取回退,无需迁移
- [批量删除中途失败] → 逐个执行、汇总成功/失败清单返回,失败项保留在列表;不回滚已删除项
- [全量重绘丢勾选/滚动位置] → 勾选集合入 app 状态并在重绘后恢复;滚动位置维持现状策略
- [搜索大小写] → 统一 `toLowerCase()` 匹配
- [归档会话被项目隐藏逻辑(hiddenProjects)波及] → 归档过滤独立于项目隐藏;恢复时按记录的 `projectPath` 回到其所属分组(分组按路径生成,不要求项目仍登记在工作区列表)

## Migration Plan

数据文件新增可选字段,直接部署;回滚即回退代码,旧代码忽略新字段,无迁移步骤。

## Open Questions

无——归档面板交互细节(入口样式)属实现层,不改变规格与任务拆分。
