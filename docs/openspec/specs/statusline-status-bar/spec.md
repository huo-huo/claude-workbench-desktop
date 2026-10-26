# statusline-status-bar Specification

## Purpose
把 Claude Code statusLine（claude-hud）显示的会话状态（模型名、上下文用量、git 分支、todo 进度、成本）以软件原生形式展示在 Claude Workbench 对话工作站底部：通过包装 statusLine 命令把 Claude Code 传入的原始数据转发给软件，软件按会话存储并在界面渲染；终端内 statusLine 的显示保持不变。

## Requirements

### Requirement: statusLine 包装器的启用与恢复

软件 SHALL 提供 statusLine 状态栏的启用/禁用开关。启用时记录用户当前 `~/.claude/settings.json` 中的原 `statusLine.command`，并将其替换为包装器命令；禁用时恢复最近一次记录的原命令。记录或写入失败时 SHALL 保持原配置不变并报告错误。

#### Scenario: 启用状态栏包装

- **WHEN** 用户在软件中启用状态栏且 `settings.json` 中存在原 `statusLine.command`
- **THEN** 软件记录原命令，并把 `statusLine.command` 替换为包装器命令；原命令内容被完整保留

#### Scenario: 禁用后恢复原命令

- **WHEN** 用户禁用状态栏
- **THEN** `settings.json` 中的 `statusLine.command` 恢复为启用前记录的原命令

#### Scenario: 写入失败不破坏配置

- **WHEN** 读取或写入 `settings.json` 失败（文件缺失、格式非法、写入被拒）
- **THEN** 原 `statusLine.command` 保持不变，软件报告具体错误

### Requirement: 包装器转发原始数据并接管终端 statusLine

包装器命令 SHALL 读取 Claude Code 通过 stdin 传入的 statusLine JSON 并转发给软件服务端。启用期间包装器 SHALL NOT 执行原 statusLine 命令——终端内原 statusLine 不再渲染，会话状态由软件状态栏替代显示，避免内容重复。软件未运行或转发失败时包装器 SHALL 静默降级（无输出、不报错、不阻塞）。

#### Scenario: 启用后终端内原状态栏不再渲染

- **WHEN** Claude Code 在任意终端刷新 statusLine 且包装已启用
- **THEN** 包装器把本次输入 JSON 转发给软件服务端，终端内不渲染原 statusLine，同样的内容只在软件状态栏显示

#### Scenario: 软件未运行时静默降级

- **WHEN** 软件服务端未运行、不可达或转发超时
- **THEN** 包装器不产生可见错误、不阻塞，静默退出

#### Scenario: 禁用后恢复原 statusLine

- **WHEN** 用户禁用包装
- **THEN** `settings.json` 中的 `statusLine.command` 恢复为启用前记录的原命令，终端内原 statusLine 恢复渲染

### Requirement: 会话状态接收与存储

软件服务端 SHALL 提供接收包装器转发的接口，按 `session_id` 保存最近一次收到的 statusLine 数据；同一会话的新数据覆盖旧数据，不同会话的状态互不干扰。

#### Scenario: 接收并按会话保存

- **WHEN** 包装器转发包含 `session_id` 的 statusLine JSON
- **THEN** 服务端以该 `session_id` 保存数据中可用的状态字段（如模型、上下文用量、工作目录、成本）

#### Scenario: 同一会话状态覆盖

- **WHEN** 同一 `session_id` 的状态被多次转发
- **THEN** 服务端只保留最近一次的内容

### Requirement: todo 进度与成本的补充解析

对于已收到的会话状态，服务端 SHALL 按 `session_id` 只读解析本机会话数据（`~/.claude/todos/` 与会话 transcript），补齐 todo 进度与成本信息；任一数据源解析失败时 SHALL 省略对应项而不影响其他状态项。

#### Scenario: 补齐 todo 进度

- **WHEN** 某会话已有转发的状态且其 todo 文件存在
- **THEN** 服务端解析出 todo 完成数与总数，随状态一起提供

#### Scenario: 数据缺失时省略对应项

- **WHEN** 某会话的 todo 文件或 transcript 不存在或无法解析
- **THEN** 状态中省略对应项，其余状态项正常提供

### Requirement: 按项目目录兜底关联会话状态

当转发的状态数据无法按记录的 CLI 会话 ID 精确匹配到工作台会话时，服务端 SHALL 按转发数据中的项目目录匹配该项目下最近使用的活动会话，使该会话的状态栏可以显示此状态；无匹配会话时状态保持按 `session_id` 存储。

#### Scenario: continue 会话通过项目目录获得状态

- **WHEN** 某会话由"继续上次对话"启动、没有记录的 CLI 会话 ID，且收到的转发数据中项目目录与该会话所属项目一致
- **THEN** 该会话的状态栏可以显示这条转发携带的状态

#### Scenario: 无匹配会话时保持存储

- **WHEN** 收到的转发数据的项目目录不匹配任何工作台会话
- **THEN** 该状态仍按 `session_id` 存储，不强行关联

### Requirement: 工作站底部状态栏显示

对话工作站 SHALL 在终端区域底部显示一条状态栏，展示当前激活会话的模型名、上下文用量、git 分支、todo 进度与成本；状态栏 SHALL 随激活会话切换而更新，会话无可用状态时显示占位提示。

#### Scenario: 显示当前会话状态

- **WHEN** 激活会话存在已转发的状态数据
- **THEN** 底部状态栏显示该会话的模型名、上下文用量、git 分支、todo 进度与成本

#### Scenario: 切换会话跟随更新

- **WHEN** 用户在会话列表中切换激活会话
- **THEN** 状态栏更新为新激活会话的状态

#### Scenario: 无状态时显示占位

- **WHEN** 激活会话没有任何已转发的状态数据
- **THEN** 状态栏显示占位提示，不显示其他会话的状态

#### Scenario: 未启用包装时保持原状

- **WHEN** 用户未启用 statusLine 包装（或已禁用）
- **THEN** 软件行为与本次变更前一致，底部不出现状态栏数据区

### Requirement: 点击模型名切换模型与思考等级

状态栏中的模型名 SHALL 可点击，点击后弹出面板列出候选模型与思考等级档位；用户选择后软件 SHALL 向当前激活会话的终端注入对应的 CLI 命令（`/model <模型>` 或 `/effort <等级>`）并立即执行。没有激活会话时 SHALL 提示而非注入。

#### Scenario: 选择候选模型

- **WHEN** 用户点击模型名并在面板中选择一个候选模型
- **THEN** 软件向当前激活会话的终端注入 `/model <模型>` 并执行，面板关闭并提示

#### Scenario: 选择思考等级

- **WHEN** 用户在面板中选择一个思考等级档位
- **THEN** 软件向当前激活会话的终端注入 `/effort <等级>` 并执行

#### Scenario: 无激活会话时拒绝切换

- **WHEN** 用户在没有激活会话的情况下点击模型名或选择候选
- **THEN** 软件提示需要先打开对话会话，不注入任何命令
