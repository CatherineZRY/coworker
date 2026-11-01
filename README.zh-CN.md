# coworker

[English](README.md) | [简体中文](README.zh-CN.md)

为 Codex 配备的本地任务看板和 Worker 队列。Codex 负责与你沟通、拆分任务和审核结果，
Claude Code、Codex 或 Cursor 负责在独立 Git worktree 中执行任务，审核后再将改动合入你的分支。

```text
你 → Codex → coworker MCP → 本地服务 → 独立 Git worktree 中的 Worker
                ↑              ↓
             审核 / 返工    SQLite 事件 → 实时网页看板
```

## 环境要求

- macOS 或 Linux，安装 Node.js 22+、pnpm 12+ 和 Git。
- 支持 MCP 的 Codex 客户端；插件支持情况取决于客户端版本。
- 至少一个已安装、已登录且在 PATH 中的 Worker CLI：`claude`、`codex` 或 `cursor-agent`。
  各 Worker 使用各自 CLI 的登录状态和用量额度。
- 要执行任务的 Git 仓库至少已有一次提交。Worker 从已提交的 `HEAD` 开始，
  不会自动复制你当前工作区尚未提交的改动。

## 首次安装

### 1. 下载并构建

```bash
git clone git@github.com:CatherineZRY/coworker.git
cd coworker
pnpm install
pnpm build
```

已经下载过项目时，直接进入现有目录即可，不必再次克隆。
如果构建成功，Vite 提示资源块超过 500 kB 只是体积警告，不影响后续安装。

### 2. 配置 `coworker` 命令

在 **coworker 仓库根目录**执行。若 `coworker --version` 已能正常运行，可以跳过。

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$(pwd)/apps/cli/dist/index.js" "$HOME/.local/bin/coworker"
export PATH="$HOME/.local/bin:$PATH"
coworker --version
```

预期版本为 `0.1.0`。这里创建的链接不会覆盖已有文件。如果提示 `File exists`，
先执行 `ls -l "$HOME/.local/bin/coworker"`，确认已有命令指向哪里，再决定如何调整。

为了让新的 **zsh** 终端也能识别命令（macOS 默认使用 zsh）：

```bash
printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
source "$HOME/.zshrc"
rehash
```

使用 bash 时，将相同的 `export` 行加入终端实际读取的启动文件；通常是 `~/.bashrc`，
登录 shell 则可能是 `~/.bash_profile`。

这是从源码目录使用的安装方式，请保留项目目录。移动目录后需要更新命令链接并重新执行
`coworker install`；在原位置重新构建不影响链接。**不要使用 `pnpm link --global`**：
本项目使用的 pnpm 12.15.0 CLI 不支持这个参数。

### 3. 安装 Codex 集成并启动

```bash
coworker install
coworker start --detach
coworker status
```

`start --detach` 会在后台启动服务并打开带认证信息的看板，默认地址是
`http://127.0.0.1:7788`。关闭终端不会停止后台服务。
想查看前台日志时使用 `coworker start`，按 Ctrl+C 停止。

安装器会创建或更新以下文件：

| 位置                             | 用途                               |
| -------------------------------- | ---------------------------------- |
| `~/.coworker/config.json`        | 运行配置                           |
| `~/.coworker/token`              | 本地 API 认证令牌                  |
| `~/.codex/config.toml`           | MCP 服务与本地插件注册             |
| `~/.codex/hooks.json`            | 用于会话和看板关联的生命周期 hooks |
| `~/.coworker/plugin-marketplace` | 内置插件及 coworker skill          |

修改已有 Codex 配置或 hooks 时，会先生成带 `.coworker-backup-<时间戳>` 后缀的备份。
**安装完成后重启 Codex**，确认 coworker 插件已启用、MCP 工具可用。

如果还没有配置全局命令，也可以在项目目录直接调用相同的 CLI：

```bash
node apps/cli/dist/index.js install
node apps/cli/dist/index.js start --detach
```

## 日常使用

启动服务，然后在**你希望 Worker 修改的目标项目**中打开 Codex 会话。
coworker 仓库用于运行工具，不要求目标项目就是 coworker 自身。

```bash
coworker start --detach
coworker open
```

接着直接向 Codex 描述任务，例如：

> 请使用 coworker skill，把“为 src/add.ts 补充测试”交给 Claude Code。
> 覆盖正数、负数和零。等待执行完成后检查实际 diff，在 Worker worktree 中运行测试，
> 并将审核结果记录到看板。暂时不要合入我的分支。

在支持技能选择器的 Codex 中，也可以显式提及 `$coworker`。
还可以说：“用 coworker 查看当前会话的任务”“检查最近一次执行结果”或
“根据这些审核意见安排返工”。

Codex 的操作流程是：

1. 确认当前会话对应的看板，以及可用的 Worker。
2. 带着目标、限制和验收命令派发任务。
3. 使用 `wait_for_board` 等待；等待超时时，携带返回的事件游标继续等待。
4. 通过 `get_run` 获取实际 patch，在本次执行的 worktree 中检查并验证。
5. 审核通过，或记录具体意见并安排下一次尝试。

等待超时只表示这次等待结束，不代表 Worker 执行失败。

## 如何看懂和操作看板

每个已发现的 Codex 会话对应一个看板。通过顶部会话选择器切换，点击 **Sync**
刷新会话列表。也可以使用不依附具体会话的本地看板。

| 列                 | 含义                               |
| ------------------ | ---------------------------------- |
| Backlog / Ready    | 待规划 / 已准备好派发              |
| Running            | 已排队、正在启动或正在执行         |
| Review             | Worker 成功退出，等待审核          |
| Changes Requested  | 审核要求修改；自动返工可能已经排队 |
| Done               | 审核通过，尚未自动合并代码         |
| Failed / Cancelled | 执行失败或已取消                   |

点击 **New task** 会创建 Ready 任务，再在任务面板中派发 Worker。
仅创建卡片或将卡片拖到 Running 列，不会启动 Worker。
任务面板用于查看尝试记录、活动、diff、评论，以及审核和重新执行。
此前浏览器冒烟测试中出现过点击卡片无法打开详情的问题；遇到时可以让 Codex 通过
`get_task`、`get_run` 和审核工具完成操作。

## 审核、返工与合入代码

- `submit_review` 使用 `approved`：任务进入 Done。
- `submit_review` 使用 `changes_requested` 或 `rejected`：只记录意见，不会启动下一次尝试。
- `request_changes`：至少需要一条评论，会自动安排下一次尝试，受 `maxAttempts` 限制，默认 3 次。
- 每次尝试都会从已提交代码创建新的 worktree。返工会携带评论和上次摘要，
  但不会自动继承上次尚未提交的代码。因此任务描述要写明完整目标，返工后要重新验证完整结果。

**Done 表示审核通过，不表示代码已合入。** 改动仍在 `run.worktreePath` 中。
可以继续让 Codex 将审核通过的改动应用到当前分支，保留你已有的本地改动，并再次验证。
需要发布时再提交和推送；多个并行任务的 patch 可能存在冲突。

## 给 Codex 使用的 skill

维护中的技能文件位于
[`packages/codex-plugin/plugins/coworker/skills/coworker/SKILL.md`](packages/codex-plugin/plugins/coworker/skills/coworker/SKILL.md)。
它会指导 Codex 选择会话看板、派发任务、等待、审核、安排返工、恢复中断任务，
并区分“审核完成”和“代码合入”。`coworker install` 会随插件安装它。
更新项目后，重新运行 `coworker install` 并重启 Codex，即可刷新已安装副本。

如果 Codex 版本无法加载插件，先只注册 MCP 和 hooks：

```bash
coworker install --skip-plugin
```

然后在 coworker 仓库中单独安装 skill。仅在插件 skill 未启用时采用这个备用方式，
避免相同技能出现两次：

```bash
mkdir -p "$HOME/.agents/skills"
cp -R packages/codex-plugin/plugins/coworker/skills/coworker "$HOME/.agents/skills/"
```

目标目录已存在时先检查内容再更新。技能没有出现时重启 Codex。
Skill 提供操作指引，**仍然需要注册 MCP** 才能控制看板。
本地技能发现与 `$` 调用方式见 [Codex 官方技能说明](https://learn.chatgpt.com/docs/build-skills)。

## 常用命令

| 命令                                | 用途                                     |
| ----------------------------------- | ---------------------------------------- |
| `coworker start --detach`           | 后台启动并打开看板                       |
| `coworker start --detach --no-open` | 后台启动，不打开浏览器                   |
| `coworker start --port 7799`        | 在其他端口前台运行                       |
| `coworker open`                     | 打开带认证信息的看板                     |
| `coworker status`                   | 查看服务和 API 状态                      |
| `coworker stop`                     | 停止服务                                 |
| `coworker doctor`                   | 检查 Node、Git、Worker、会话、服务和 API |
| `coworker config`                   | 查看配置                                 |
| `coworker install`                  | 安装或刷新 MCP、hooks 和插件             |
| `coworker mcp`                      | MCP stdio 服务，通常由 Codex 自动启动    |

## 配置与常见问题

配置位于 `~/.coworker/config.json`，修改后重启服务。

| 配置                                              | 默认值 / 用途                             |
| ------------------------------------------------- | ----------------------------------------- |
| `host`、`port`                                    | `127.0.0.1`、`7788`                       |
| `maxConcurrentRuns`                               | 并发数 `4`                                |
| `defaultTimeoutSec`                               | 每次执行 `1800` 秒                        |
| `maxAttempts`                                     | 自动返工最多 `3` 次尝试                   |
| `defaultRepo`                                     | `null`；看板 cwd 不是仓库时使用的备用仓库 |
| `allowedRoots`                                    | `[]`；设置后限制可使用的仓库目录          |
| `workers.claudeCode.command`                      | `claude`                                  |
| `workers.claudeCode.permissionMode`               | `bypassPermissions`，用于无人值守执行     |
| `workers.codex.command`、`workers.cursor.command` | `codex`、`cursor-agent`                   |

`COWORKER_HOME` 更改数据目录，`CODEX_HOME` 更改 Codex 配置和会话目录，
`COWORKER_WEB_DIST` 更改网页构建产物位置。
通过 UI 在本地看板创建任务时，若看板没有关联的仓库 cwd，需要把 `defaultRepo`
设置为目标仓库；它是共享的备用配置，不是每个任务独立的配置。

- **找不到命令**：检查 `command -v coworker`、链接与 PATH；zsh 中可执行 `rehash`。
  `apps/cli/dist/index.js` 必须已构建且仍在原位置。
- **看板提示未授权**：使用 `coworker open` 打开带认证信息的地址。
- **会话名不一致或显示 Guardian review**：新版优先读取主会话显示名称，并排除内部会话。
  已有错误关联可按 [安全修复步骤](docs/operations.md#repairing-a-board-attached-to-an-internal-session)
  重新绑定看板；Worker 执行中不要重启服务。
- **Codex 看不到工具**：重跑 `coworker install`，重启 Codex，检查插件和 MCP；
  必要时采用上面的单独安装技能方式。
- **Worker 不可用**：安装并登录对应 CLI；`doctor` 检查命令是否可用，不保证认证成功。
  未安装的闲置 Worker 也可能导致 doctor 显示未通过项。
- **不是 Git 仓库 / 没有提交**：在有提交的仓库内开启 Codex，或配置 `defaultRepo`。
  本地未提交的改动不会进入 Worker worktree。
- **服务启动失败**：查看 `~/.coworker/logs/daemon.log`，使用 `coworker status`
  检查状态；端口被占用时可以选择其他端口。

更多存储位置、恢复方法与数据流见 [运维说明](docs/operations.md) 和
[架构说明](docs/architecture.md)（英文）。

## 安全与当前限制

服务默认只监听本机，API 使用 bearer token 或 `coworker_token` cookie 认证。
不要分享带令牌的地址。SQLite 等状态保存在 `~/.coworker`。
Worker 以你的用户身份和配置的 CLI 权限运行；worktree 隔离 Git 改动，不隔离主机文件访问权限。

Codex 会话发现读取 `~/.codex/state_*.sqlite`，其表结构变化时可能需要调整。
存储的 diff 上限是 5 MB，MCP `get_run` 返回的 patch 超过 60,000 字符时还会截断；
大型改动需要检查完整 worktree。Worker 的改动应保留为未提交状态，直到审核，
以便 coworker 采集暂存区 diff。

## 开发命令与目录

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

```text
apps/cli/        命令行、安装、MCP stdio 服务
apps/daemon/     API、认证、调度、会话同步、SSE
apps/web/        React 看板、任务面板、diff 查看
packages/core/   SQLite 模型、仓库与领域服务
packages/shared/ 领域类型和输入校验
packages/adapters/ Git worktree、配置、Worker、Codex hooks
packages/codex-plugin/ 插件清单和 coworker skill
tests/           Vitest 测试
docs/            架构与运维文档
```
