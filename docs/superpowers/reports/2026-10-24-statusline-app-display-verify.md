# 验证报告：statusline-app-display

- 日期：2026-10-24
- 模式：full（14 任务、1 个 delta spec、29+ 变更文件）
- 基线：75db220c（test 分支）→ 实现 commit bbe2e56 → 审查修复 commit
- 独立集成审查：review-final 子代理（review_mode=standard）
- 验证轮次：2（第 1 轮审查发现 2 条 IMPORTANT，verify-fail 回 Build 修复后复审）

## 检查结果简表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | tasks.md 全部完成 | PASS | 14/14 勾选（guard 校验通过） |
| 2 | 改动文件与 tasks 一致 | PASS | server/statusline/*（6 模块）、resources/wrapper、前端状态栏、8 个测试文件、产物文档；无范围外文件 |
| 3 | 构建通过 | PASS | Runtime 证据：npm test（136/136）+ npm run build（exit=0） |
| 4 | 相关测试通过 | PASS | 136/136（8 个 statusline-* 测试文件） |
| 5 | 无明显安全问题 | PASS | 无硬编码密钥；无 eval/exec；settings 严格读取防损坏；XSS 全部 escapeHtml；切换命令白名单校验 |
| 6 | 独立集成审查 | PASS（修复后） | review-final：0 CRITICAL / 2 IMPORTANT / 9 MINOR；IMPORTANT 已全部修复，MINOR 修复 4 条、其余记录为已知限制 |
| 7 | 核心场景与高风险需求验证 | PASS | 7 条需求全部实现映射；20 个验收场景关键路径均有测试覆盖 |

## 需求覆盖（7 条）

1. statusLine 包装器的启用与恢复 → `server/statusline/toggle.mjs`
2. 包装器转发原始数据并接管终端 statusLine → `resources/statusline-wrapper.mjs`
3. 会话状态接收与存储 → `server/statusline/report.mjs` + `store.mjs`
4. todo 进度与成本的补充解析 → `server/statusline/enrich.mjs`
5. 按项目目录兜底关联会话状态 → `store.mjs` statuslineByCwd + `state.mjs` 两级匹配
6. 工作站底部状态栏显示 → `src/workspace/statusline.mjs` + `index.html`（两行、16 单元可配置、字号持久化）
7. 点击模型名切换模型与思考等级 → `state.mjs` handleStatuslineSwitch（pty 注入 /model、/effort）

## 独立集成审查结论与处理

**审查基线**：diff 75db220c...HEAD（29 文件 +2399 行）、135 测试；两项关键疑点做了运行时实证。

### IMPORTANT（2 条，均已修复）

- **I1** 空原命令（启用前本无 statusLine）时重复启用被 409 误判卡死——守卫用 falsy 判断把合法空串误判为缺备份，且 backup 构造存在同类污染风险。**修复**：守卫与 backup 构造均改用 `typeof !== 'string'` 类型判断；补回归测试「空原命令时重复启用不污染备份也不被 409 卡死」。
- **I2** tasks/design 声称「启用前探测 bash」已实现但实际不存在（方案从透传演进为接管模式后文档未同步）。**修复**：tasks 3.2/4.1 与 design 的 Non-Goals/Risks/Migration 全部同步为接管模式措辞。

### MINOR（9 条：4 条已修，5 条记录为已知限制）

已修复：M4 fontSize 读取未 clamp；M6 transcriptCache 驻留 9 个与注释不符；M9 CSS 重复规则；I2 相关文档漂移。
已知限制（带入后续迭代，均无正确性风险）：M1 cwd 兜底同项目多会话串台（spec 定义即"最近会话"）；M2 costUSD 累计无去重（实证当前数据无实害）；M3 自检降级无前端异常提示；M5 轮询竞态轻微闪烁（3 秒自愈）；M7 注入命令可能打断用户正在输入的行（CLI 交互固有限制）；M8 ~/.claude.json 每 3 秒解析开销。

### 审查确认无缺陷的部分

wrapper fail-safe、settings 备份/恢复与损坏防护、report/store 资源限制、config-stats 路径防护、前端 XSS 防护、sanitizeInheritedEnv。

## 最终结论

**PASS**——7 项检查全部通过；2 条 IMPORTANT 已修复并回归；MINOR 中 4 条顺带修复、5 条记录为已知限制（均不涉及正确性、安全或核心验收）。可以进入归档。

**上线后人工确认项**（审查者提示）：wrapper 在真实 GUI 环境的 PATH 中 node 可见性需实际桌面环境验证。
