# dsh-codex-claude-pipeline

**Codex 规划 + Claude Code 执行** —— DeepSeek Harness 的 Agent preset 插件。新建会话时选择这个模式，
会话主代理只做调度：先让 **Codex 子代理**分析任务、拆出工作项，再把每个工作项交给
**Claude Code 子代理**实际执行，最后核对结果并向你汇报。

```
你 → 主代理（调度器）
        ├─ 1. subagent_codex ──────→ Codex（只读分析、拆工作项）
        └─ 2. subagent_claude_code ─→ Claude Code（逐项改文件、跑命令、自验证）
     ← 主代理核对、补派、汇报
```

## 它和另外两个委托模式有什么不同

| 模式 | 谁负责分析和拆解 | 谁负责执行 |
|---|---|---|
| Codex 委托 | 主代理 | Codex |
| Claude Code 委托 | 主代理 | Claude Code |
| **本模式** | **Codex** | **Claude Code** |

本模式把「想清楚」和「动手做」分给两个各自擅长的外部代理：Codex 只读分析、出计划，不碰工作区；
Claude Code 拿着计划逐项执行。主代理不参与任何实际工作，只负责写清楚任务说明、在两者之间传递
信息、核对验收标准。

## 安装

```bash
# registry（发布后）
dsh plugin --profile <profile> add dsh-codex-claude-pipeline

# 本地开发版：直接指向目录，profile 会用 link: 依赖它，改完 patch 立即生效
dsh plugin --profile <profile> add /abs/path/to/dsh-codex-claude-pipeline
```

或在 Web/Desktop 的 **插件** 页面安装（`plugin_manager` 的 `install_bundle`，target 为包名或本地目录）。
安装后新建会话，在模式列表里选择 **Codex 规划 + Claude Code 执行**。已有会话不会自动切换模式；
`link:` 安装时不要移动或删除该目录。

### 前置条件

- 本机 Codex 已安装并登录（DSH 的 Codex 子代理走原生 Codex，认证与 `~/.codex/config.toml` 都是权威来源）。
- 本机 Claude Code 已登录（原生 `settings.json` / `~/.claude.json` 是认证与其它原生设置的权威来源，
  本插件不会替你登录或改写这些文件）。
- DSH 版本满足本包的 `engines.dsh`（见 `package.json`）。

`@deepseek-ai/dsh-subagent-codex` 与 `@deepseek-ai/dsh-subagent-claude-code` 已声明为本包的依赖，
`dsh plugin add` 会一并装好；本插件的 patch 自己注册专用 provider，所以**不需要**额外启用这两个官方
bundle。你若已经启用了它们也不冲突：它们注册的是全局 `codex` / `claude-code` provider 与全局工具，
本插件用的是另两个名字的专用 provider。

## 这个模式里有什么

preset 只注册两个委派工具、一个澄清工具、一个进度工具：

| 工具 / 插件 | 作用 |
|---|---|
| `subagent_codex` | 规划入口，指向本插件注册的专用 provider `codex-planner` |
| `subagent_claude_code` | 执行入口，指向本插件注册的专用 provider `claude-code-executor` |
| `ask_user_question` | 需求有关键歧义时先问用户 |
| `todo_write` | 多工作项的进度跟踪（只写会话日志） |
| `compaction` | 长会话压缩：规划与执行结果会持续累积，避免上下文溢出 |

> **注意**：profile 级的全局工具依然存在（例如 `working_directory`、MCP 工具、插件管理工具），
> 它们对 preset 里的 Agent 仍然可见。本插件目前**只靠 persona 约束**主代理不去使用它们。
> 需要硬隔离（把这些全局工具从该 preset 的 Agent 里隐藏）要额外的 Agent 级 `ctx.tools.restrict()`
> 插件；在 preset 作用域调用 `restrict()` 会连同 preset 自己注册的工具一起藏掉，所以这类 gate 必须
> 按 Agent 作用域实现。

系统提示词（`complete: true`，只有这一段）把主代理定义成调度器，并固定了工作流：

1. 判断请求类型；纯寒暄或对已有结果的追问直接回答，有歧义先澄清；
2. 派 `subagent_codex` 做只读分析，要求按「结论 / 工作项 / 不确定处」固定结构输出，工作项要小到
   一次能执行完，并标出依赖与可并行项；
3. 等完成通知后才派执行任务，把 Codex 工作项原文完整转交（执行子代理看不到会话历史和规划结果）；
4. 一次只派一个工作项，无依赖的可以同轮并行；结果对照验收标准核对，失败就补派聚焦的修正任务，
   计划不可行就交回 Codex 重新规划；
5. 汇报时区分「子代理报告完成」和「已验证」，不声称自己执行过命令或改过文件。

两个子代理都是**外部一次性会话**：看不到会话历史、不接受追加消息、结束后不能恢复。所以任务说明
必须自包含；persona 已经要求主代理这样写。

## 两个子代理的权限

| provider | permissionMode | 为什么 |
|---|---|---|
| `codex-planner` | `never` | 规划只需要读文件、检索、看 git 历史。`never` 是无人值守下最保守的档位：不请求审批，沙箱由 Codex 原生配置决定（未改 `~/.codex/config.toml` 的默认配置下实测为只读，工作区内也写不了文件）。persona 另外明确要求 Codex 只读分析、不执行有副作用的命令。 |
| `claude-code-executor` | `auto` | 执行要真正改文件、跑命令。`auto` 由 Claude Code 原生分类器逐项裁决，不需要人工审批；被拒绝的操作会让执行子代理报告出来，而不是卡住等人。 |

两者都是**提示词级约束**：如果你把 Codex 原生 `sandbox_mode` 配成可写、或把 Claude Code 的
`permissionMode` 改成 `bypassPermissions`，模式本身不会阻止对应代理越界，这是配置责任。

## 它怎么接进去

`cordis.patch.yml` 插入三行：

1. **Host 行 `subagent-codex-planner`**：规划用 Codex provider（`providerName: codex-planner`）。
2. **Host 行 `subagent-claude-code-executor`**：执行用 Claude Code provider（`providerName: claude-code-executor`）。
3. **Preset 行 `preset-codex-claude`**：声明 preset `codex-claude`，两个委派工具与全局工具同名、
   按 Agent 作用域规则遮蔽全局工具，从而落到上面两个专用 provider 上。

两个 Host 行都不注册任何全局工具，所以其它模式里由官方 bundle 提供的全局 `subagent_codex` /
`subagent_claude_code` 完全不受影响。

## 配置

在本机 profile 的 `cordis.patch.yml` 里按行 id 覆盖即可，不需要改本插件的文件：

```yaml
- id: subagent-codex-planner
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    providerName: codex-planner          # 改了必须同步 preset 里的 provider
    permissionMode: never                # never | approve-for-me | dangerously-bypass-approvals-and-sandbox
    # model: '<codex-model-id>'          # 固定 Codex 使用的模型

- id: subagent-claude-code-executor
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    providerName: claude-code-executor   # 改了必须同步 preset 里的 provider
    permissionMode: auto                 # dontAsk | acceptEdits | auto | plan | bypassPermissions
    # model: '<claude-model-id>'         # 固定 Claude Code 使用的模型
```

| Codex `permissionMode` | 行为 |
|---|---|
| `never` | 永不请求审批；sandbox 走 Codex 原生配置（默认实测只读）。规划用，推荐。 |
| `approve-for-me` | 自动评审权限请求，`sandbox: workspace-write`。规划任务本身不需要写，一般没必要改。 |
| `dangerously-bypass-approvals-and-sandbox` | 跳过审批与 sandbox，全盘可写。慎用。 |

| Claude Code `permissionMode` | 行为 |
|---|---|
| `dontAsk` | 不弹提示，未预授权的操作直接拒绝（最保守） |
| `acceptEdits` | 自动接受文件编辑，其余权限请求拒绝（能改文件，基本跑不了命令） |
| `auto` | 由 Claude Code 原生分类器逐项裁决（默认） |
| `plan` | 原生规划模式：只出计划，不执行 |
| `bypassPermissions` | 跳过所有权限检查，风险最高；无人值守流水线里确实需要放开时再用 |

修改后重新应用配置层（重启应用，或 profile 启用了 HMR 时的热重载）即可；preset 的改动只影响之后
新建的会话。

## 装完怎么验证

按顺序检查三层，任意一层不对就停在那层：

1. **行激活**：`plugin_manager` → `list_plugins`，确认 `subagent-codex-planner`、
   `subagent-claude-code-executor`、`preset-codex-claude` 都是 `enabled: true`、`fiberPhase: active`。
2. **preset 已注册**：`cordis_inspect_query` → `Config.listConfigs`（name 过滤
   `@deepseek-ai/dsh-agent-preset`），应能看到 `preset-codex-claude`。
3. **真实流水线**：新建会话选「Codex 规划 + Claude Code 执行」，先给一个小任务（例如让它在临时
   文件里加一行再读回来）。确认：主代理先只派 `subagent_codex`；规划结果到达后才出现
   `subagent_claude_code` 调用；最后汇报里写清了改动的文件与验证结果。

常见故障：

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 模式列表里没有「Codex 规划 + Claude Code 执行」 | 插件未启用 / preset 行挂载失败 | 回到第 1、2 步看诊断 |
| 有模式，但主代理说没有 `subagent_codex` | Codex provider 包解析不到或 Host 行未激活 | `list_plugins` 看 `subagent-codex-planner` |
| 有模式，但主代理说没有 `subagent_claude_code` | Claude Code provider 包解析不到或 Host 行未激活 | `list_plugins` 看 `subagent-claude-code-executor` |
| 规划任务失败，诊断指向 `process` / `initialize` | Codex 未登录、app-server 载荷缺失、平台不支持 | 先在终端跑一次 `codex login status` |
| 执行任务能读不能写、跑不了命令 | Claude Code `permissionMode` 过于保守 | 保持 `auto`；确实被拒的操作改用 `bypassPermissions`（风险自负） |
| 规划完成后不派执行任务 | 用户只要求分析；或计划被判为不可执行 | 看主代理汇报里的「遗留问题」，必要时让它补派 |

## 限制与已知问题

- **只有提示词级隔离**：全局工具仍对该模式的 Agent 可见（见上文）。要硬隔离需要 gate 插件。
- **子代理是一次性的**：不能追加消息、不能恢复会话、看不到父会话历史，任务说明必须自包含。
- **异步返回**：委派调用只返回任务 id，结果通过完成通知到达。persona 明确要求等待期间不轮询、
  不重复派单。
- **没有独立验收**：主代理只能核对子代理报告的结果，不能自己运行测试确认验收标准。
- **网络与模型**：Codex / Claude Code 使用各自原生配置与认证，本插件不管理登录、模型或网络策略。

## 可调项

- **更硬的约束**：加一个 gate 插件，用 `ctx.tools.restrict(...)` 把全局工具也屏蔽掉。当前版本
  **未包含**：`restrict` 要求调用方处于 scoped context，preset 作用域下注册与遮蔽的交互（是否会
  把 preset 自己挂的工具一起挡掉）只有真实会话能验证，未验证前不发布硬隔离。
- **不想要进度工具**：删掉 `tool-todo` 行，同时删掉 persona 里对应规则。
- **只想 Codex 规划、不做任何改动**：本模式天然支持：分析类请求只走 Codex，不派执行任务。
- **换工具名**：改 `toolName` 后同步改 persona 里的两个名字。

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-codex-claude-pipeline
```

或 `plugin_manager` 的 `remove_bundle`。

## 兼容性

`engines.dsh` 见 `package.json`（`>=0.2.1 <0.3.0-0`）。依赖 Harness 的 Agent preset、
`dsh-tool-subagent`、`dsh-subagent-codex` 与 `dsh-subagent-claude-code` 接口；官方包版本变化后
建议先跑一次新模式的小任务验证。

## 开发

```bash
npm test        # 无依赖的静态 smoke test：patch/package/locale/文件清单一致性
npm pack --dry-run
```

## 变更记录

### 1.0.0

- 首个版本：`preset-codex-claude`（persona + scoped `subagent_codex` + scoped
  `subagent_claude_code` + `ask_user_question` + `todo_write` + compaction）。
- Host 层注册两个专用 provider：`codex-planner`（只读规划）与 `claude-code-executor`（`auto` 执行）。

## License

MIT
