# 架构

## 设计目标

1. **单一事实来源**：技能的字节只存在于一处。
2. **接口一致**：CLI、HTTP、MCP 三个入口共用同一套核心函数，行为不会漂移。
3. **失败安全**：任何破坏性操作都要先证明「这是我建的东西」。
4. **零依赖**：目标机器常常装不上依赖，`node src/cli.js` 必须能直接跑。

## 模块图

```
cli.js ─────────────┐
                    ├── core/index.js ──┬── core/hub.js       (扫描 / 安装 / 删除 / 汇总 / 偏好)
server/http.js ─────┤                   ├── core/plan.js      (链接计划)
server/api.js ──────┤                   ├── core/linker.js    (创建 / 安全移除链接)
mcp/server.js ──────┘                   ├── core/tools.js     (工具注册表与探测)
                                        ├── core/installer.js (GitHub / 本地安装)
                                        ├── core/importer.js  (拖拽上传)
                                        ├── core/git.js       (仓库状态与初始化)
                                        ├── core/frontmatter.js
                                        ├── core/tokens.js    (估算 / 分档 / 预测)
                                        └── core/zip.js
```

`core/index.js` 是唯一的公共门面。三个入口都不直接 `import` 内部模块，除了 `plan.js` 的 `countByAction`（纯函数）和 `tokens.js` 的格式化函数。

`server/multipart.js` 只被 `http.js` 使用：它把浏览器上传的字节流切成 `{ name, filename, data }`，再由 `importer.js` 落到临时目录，之后走和 `add` 完全相同的 `discoverSkillDirs` → `installFromDir` 路径。**上传不是第二条安装通道，只是另一种取包方式。**

## 数据流：一次 `add`

```
skillhub add owner/repo
  │
  ├─ installer.parseSource()        判定是 GitHub 还是本地路径
  ├─ fetchGitHubArchive()           codeload zip → 临时目录 → zip.js 解压
  ├─ discoverSkillDirs()            递归找含 SKILL.md 的目录，遇到即停（不拆子技能）
  ├─ hub.installFromDir()           fs.cpSync 到 hub/<name>；已存在则跳过
  ├─ config.sources[repo] = {...}   记录来源与安装时间
  └─ linkAll()                      → plan → apply
```

`linkAll` 永远先算计划：

```
buildPlan({ hub, skills, tools, shelf })
  └─ 对每个 (tool, skill)：inspectLink() → create | remove | ok | blocked | foreign
applyPlan(plan, { dryRun })
  └─ 只执行 create / remove；其余只上报
```

`--dry-run`、控制台的「应用链接」、`doctor` 的「plan is clean」全都复用这一个计划对象，所以「预览」和「执行」不可能不一致。

## 状态存放

| 文件 | 内容 |
| --- | --- |
| `~/.skillhub/skillhub.json` | 上架名单 `shelf`、预算 `budget`、每日请求数 `dailyRequests`、自定义工具 `tools`、来源 `sources` |
| `~/.skillhub/<name>/SKILL.md` | 技能本体（每个技能一个目录） |

`skillhub.json` 是唯一的可写状态，其它一切皆为普通文件。这让中心天然适合 `git`：diff 可读、冲突可解、回滚简单。

`shelf: null` 表示「全部上架」，`shelf: []` 表示「全部下架」。用 `null` 而不是复制一份全量列表，是为了让新装的技能默认可见——大多数人装完就想用。当 `shelf` 是显式列表时，安装流程会把新技能追加进去（`addToShelf`），保持同一个直觉。

## 成本模型

```
每轮目录开销 = Σ (name + description 的 token 估算)
预算占比     = 每轮开销 / budget
每日         = 每轮 × dailyRequests
每月         = 每日 × 30
```

分档（`tierOf`）：`≤25` 轻、`≤60` 中、`≤120` 重、其余极重。分档只影响展示与颜色，不改变任何行为——它存在的意义是让「这个技能值不值」变成可比较的数字。

`budgetState` 在 `≥80%` 返回 `warn`、`≥100%` 返回 `over`；控制台据此把预算条染黄/染红。没有配置预算时恒为 `ok`，不会用警告打扰第一次打开的人。

## git 集成

`git.js` 只做三件事：读状态（分支、remote、未提交数、提交数）、写 `.gitignore`、`git init` + 首提交。所有 `spawnSync` 都带超时，找不到 git 时返回 `{ ok: false, reason, next }` 并把要手敲的命令列出来——**没有 git 不是错误，只是少一个便利功能**。

## 链接策略

| 平台 | 方式 | 是否需要特权 |
| --- | --- | --- |
| Windows | `fs.symlinkSync(target, path, 'junction')` | 否 |
| macOS / Linux | `fs.symlinkSync(target, path, 'dir')` | 否 |

移除链接时：

- Windows：`fs.rmdirSync(link)` —— 只删除重解析点，绝不进入目标；
- POSIX：`fs.unlinkSync(link)`。

两者都先 `lstat` 确认 `isSymbolicLink()`，否则抛错。这条规则是「跑十次也不会毁数据」的全部原因。

## 权限模型

| 绑定地址 | 读接口 | 写接口 |
| --- | --- | --- |
| `127.0.0.1`（默认） | 允许 | 允许 |
| `0.0.0.0` / 局域网 IP | 允许 | 需要 token |

token 由服务启动时生成（或 `--token` / `SKILLHUB_TOKEN` 指定），写请求带 `x-skillhub-token` 头或 `?token=` 查询参数，比较用 `crypto.timingSafeEqual`。

## 扩展点

| 想做什么 | 改哪里 |
| --- | --- |
| 支持一个新工具 | `src/core/tools.js` 的 `TOOL_REGISTRY` 加一行，或在 `skillhub.json` 里写 `tools` |
| 换 token 估算方式 | `src/core/tokens.js`（保持 `estimateTokens` 签名） |
| 调整分档阈值 | `src/core/tokens.js` 的 `TIERS` |
| 加一个 CLI 命令 | `src/cli.js` 的 `switch` + 一个 `cmdXxx` 函数 |
| 加一个 REST 接口 | `src/server/api.js` 的 `handleApi` |
| 加一个 MCP 工具 | `src/mcp/server.js` 的 `TOOLS` + `callTool` |
| 加一个控制台视图 | `web/app.js` 的 `VIEWS` + 一个 `viewXxx()` 函数 |
| 改控制台外观 | `web/styles.css` 的 CSS 变量（`--accent`、`--radius`、`--tier-*` 等） |

## 测试策略

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| 单元 | `test/frontmatter.test.js` | frontmatter 解析/改写、折叠标量、CRLF |
| 单元 | `test/tokens.test.js` | 估算的单调性、中英混合、分档、成本预测、预算状态 |
| 单元 | `test/zip.test.js` | stored/deflate、目录穿越、非 zip |
| 单元 | `test/linker.test.js` | 创建、移除、拒删真实目录、blocked/foreign |
| 单元 | `test/hub.test.js` | 安装、列举、删除、配置往返、BOM 容错、源解析 |
| 单元 | `test/plan.test.js` | 计划生成、幂等、dry-run、冲突保护 |
| 单元 | `test/tools.test.js` | 工具探测规则、显式列表覆盖、目录解析 |
| 单元 | `test/git.test.js` | 状态读取、初始化幂等、无 git 时降级、remote 解析 |
| 单元 | `test/importer.test.js` | 路径校验、嵌套技能、覆盖策略、无 SKILL.md |
| 单元 | `test/multipart.test.js` | 字段/文件解析、二进制、CRLF、畸形边界 |
| 单元 | `test/markdown.test.js` | 预览渲染：标题/列表/代码/表格/转义 |
| 接口 | `test/api.test.js` | REST 路由：state、preferences、reveal、shelf、开关、404 |
| 前端 | `test/web.test.js` | 用最小 DOM 桩真正执行 `web/app.js`：五个视图、筛选、开关、命令面板、总目录 |
| 端到端 | `scripts/smoke.js` | 真 CLI → 真链接 → 真 HTTP → 真上传 → 真 git → 真 MCP 握手 |
