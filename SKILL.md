# Claude Agent Hub

自驱式 AI 任务系统 — 用自己来开发自己，目标是从工具进化为有生命力的自驱智能体。

> 愿景详见 [VISION.md](./VISION.md) | 核心 DNA：自举优先、渐进自治、本地优先

## 核心命令

```bash
# 任务（必须在目标项目目录下运行，cwd 用于同项目冲突检测和自动串行）
cah "任务描述"           # 创建并执行任务（-p priority, -a agent, -b backend, -m model）
cah "任务描述" -F        # 前台运行（可看日志）
cah "任务描述" --no-run  # 仅创建不执行
cah list                 # 查看任务列表（快捷方式，支持 -s/-a/--source/--no-progress/-w/-i）
cah logs <id>            # 查看任务日志（快捷方式，支持 -f/-n）
cah run                  # 手动执行队列中下一个 pending 任务
cah init                 # 初始化项目配置（-f 强制覆盖）
cah task list            # 查看任务列表
cah task add             # 创建任务（-t title, -d desc, -p priority, -a agent）
cah task show <id>       # 任务详情（--json, --verbose）
cah task logs <id> -f    # 实时查看任务日志（-n/--tail, --head）
cah task stats <id>      # 执行统计（-t timeline, -r report, --markdown, --json）
cah task resume <id>     # 恢复中断的任务（-a all）
cah task pause <id>      # 暂停运行中的任务（-r reason）
cah task stop <id>       # 停止/取消任务
cah task delete <id>     # 删除任务
cah task clear           # 批量清理（-s status, -a all）
cah task msg <id> <msg>  # 向运行中任务发送消息
cah task inject-node <id> <prompt>  # 动态注入节点（--persona name）
cah task complete <id>  # 完成任务（审核通过）
cah task reject <id>     # 驳回任务（-r reason）
cah task trace <id>      # 查看执行追踪（--slow [ms], --errors, --cost, --export）
cah task snapshot <id>  # 查看任务执行快照（--json）

# 守护进程
cah start                # 启动守护进程（前台，自动检测飞书/Telegram）
cah start -D             # 后台运行（fork 子进程）
cah stop                 # 停止守护进程
cah restart              # 重启守护进程（默认后台，-D）
cah status               # 查看运行状态

# 报告 & 工具
cah report work          # 工作报告（-a agent, -d days, -o output）
cah report trend         # 趋势分析报告（-d days, -p period, --json）
cah report live          # 实时状态监控（--json, -w watch, -i interval）
cah dashboard            # 启动 Workflow 可视化面板（-p port, --open, -D）
cah agent list           # 查看可用 Agent
cah agent show <name>    # 查看 Agent 详情

# 记忆
cah memory list          # 查看记忆列表（-c category, --project）
cah memory add <content> # 手动添加记忆（-c category）
cah memory search <query># 搜索记忆
cah memory delete <id>   # 删除记忆
cah memory health        # 记忆健康状态
cah memory fading        # 即将消退的记忆
cah memory reinforce <id># 强化记忆
cah memory associations <id>  # 查看关联
cah memory episodes      # 情景记忆列表（-l limit）
cah memory recall <query># 回忆对话（-l limit）
cah memory link <episodeId> <memoryId>  # 关联情景与语义记忆
cah memory cleanup       # 遗忘清理（--dry-run）

# 提示词
cah prompt versions <p>  # 查看人格提示词版本
cah prompt rollback <p> <vid>  # 回滚提示词版本
cah prompt diff <p> <v1> <v2>  # 对比版本内容
cah prompt test <p>      # 启动 A/B 测试（-s min-samples）
cah prompt evaluate <id> # 评估测试结果
cah prompt extract       # 提取成功模式（-l limit）

# 自管理
cah self check           # 信号检测（stale daemon、corrupt data 等）
cah self check --auto-fix # 检测并自动修复
cah self evolve          # 运行一轮自我进化
cah self evolve analyze  # 分析失败任务模式（-n limit）
cah self evolve validate <id> # 验证进化效果
cah self evolve history  # 查看进化历史（-n limit）
cah self drive start     # 启动自驱模式
cah self drive stop      # 停止自驱（daemon 重启会恢复）
cah self drive disable   # 永久禁用（daemon 重启不恢复）
cah self drive enable    # 重新启用
cah self drive status    # 查看自驱状态
cah self drive goals     # 查看自驱目标
cah self status          # 综合状态（健康+进化+自驱）

# 后端 & 系统
cah backend list         # 列出可用后端
cah backend current      # 当前后端
```

## 任务执行流程

```
cah "描述" → createTask(含 cwd) → analyzeProjectContext → learnFromHistory
  → retrieveRelevantMemories → AI generateWorkflow → startWorkflow
  → NodeWorker 并发执行节点(Persona) → invokeBackend → saveWorkflowOutput
  → emitWorkflowCompleted → updateTask(completed/failed)
```

恢复流程：`cah task resume <id>` → recoverWorkflowInstance → 有 failed 节点则重试，全 pending 则重启

## 数据结构

数据目录：`.cah-data/`（可通过 `-d <path>` 或 `CAH_DATA_DIR` 指定）

```
.cah-data/
├── tasks/task-{id}/
│   ├── task.json       # 元数据（id, title, status, priority, cwd, source）
│   ├── workflow.json   # 工作流定义（节点、边、变量）
│   ├── instance.json   # 唯一执行状态源（节点状态、输出、变量）
│   ├── process.json    # 后台进程信息（PID）
│   ├── messages.json   # 任务交互消息队列
│   ├── stats.json      # 聚合统计（从 instance 派生）
│   ├── timeline.json   # 事件时间线
│   ├── logs/
│   │   ├── execution.log       # 主执行日志
│   │   ├── conversation.log    # 对话日志
│   │   ├── events.jsonl        # JSONL 事件流
│   │   └── conversation.jsonl  # JSONL 对话流
│   ├── outputs/        # result.md
│   └── traces/         # trace-{traceId}.jsonl（OTLP 兼容 Span 数据）
├── memory/             # 语义记忆条目
├── episodes/           # 情景记忆
├── prompt-versions/    # 提示词版本历史
├── queue.json          # 任务队列
├── runner.lock         # 队列 Runner 锁
├── runner.log          # Runner 日志
├── meta.json           # 元数据
└── index.json          # 任务索引
```

## 开发

```bash
pnpm run dev            # 开发模式（tsx watch）
pnpm run dev:dashboard  # 面板开发模式
pnpm run build          # 构建（tsup + dashboard）
pnpm run build:types    # 仅构建类型声明
pnpm run build:dashboard # 构建面板
pnpm run build:binary   # 构建独立二进制（SEA）
pnpm run lint           # Lint
pnpm run lint:fix       # Lint 自动修复
pnpm run typecheck      # 类型检查（tsc --noEmit）
pnpm test               # 测试（vitest）
pnpm run test:watch     # 测试监控模式
pnpm run format         # 格式化（prettier）
pnpm run format:check   # 格式检查
pnpm run clean          # 清理构建产物
```

## 常见问题排查

- **Daemon 不响应**: `cah stop && cah start -D` 重启（或 `cah restart`）；rebuild 后必须重启 daemon 才能加载新代码
- **任务卡在 running**: 检查 `process.json` 中 PID 是否存活（`kill -0 <pid>`），若进程已死则为 orphan，下次 `cah` 调用会自动恢复
- **Orphan detection 误判**: `checkAndResumeOrphanedTasks()` 在每次 CLI 调用时执行，依赖 `process.json` 存在。缺少 process.json 的 running 任务不会被检测到
- **测试删除生产数据**: 测试必须使用隔离数据目录（`vitest.config.ts` 设置 `CAH_DATA_DIR` 为 tmpdir），`tests/setup.ts` 有安全检查拒绝清理非 tmp 目录
- **caffeinate 不生效**: macOS 需要 `-i` flag 防止 idle sleep
- **同项目任务冲突**: `cah` 记录 `cwd` 到 task.json，同 cwd 的任务自动串行。必须在目标项目目录下运行 `cah`，否则冲突检测失效

## Backend 对比

| Backend     | Streaming | Session | Cost | MCP | Agent Teams |
| ----------- | --------- | ------- | ---- | --- | ----------- |
| claude-code | ✓         | ✓       | ✓    | ✓   | ✓           |
| opencode    | ✓         | ✓       | ✗    | ✗   | ✗           |
| iflow       | ✓         | ✓       | ✓    | ✗   | ✗           |
| codebuddy   | ✓         | ✓       | ✓    | ✗   | ✗           |
