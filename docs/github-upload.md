# 上传到 GitHub：文件清单与说明

这份文档回答两件事：**仓库里到底有哪些文件**、**怎么把它推上去**。

当前状态：**58 个文件，约 535 KB，零运行时依赖**。没有 `node_modules`、没有构建产物、没有任何密钥。

---

## 一、上传前自检（30 秒）

在仓库根目录执行：

```powershell
npm test          # 预期：111 个测试全部通过
npm run smoke     # 预期：18 项端到端检查通过
npm run check     # 预期：checked 32 JavaScript files, 3 web assets, ...
npm pack --dry-run  # 预期：29 files, ~181 KB（npm 包会比仓库小，不含 test/scripts）
```

四条都绿再推，CI 上跑的是同样的命令。

---

## 二、完整文件清单

### 1. 根目录：项目元数据

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `package.json` | 1.2 KB | 包元数据：`bin.skillhub`、`files`、`engines>=18.17`、`exports`、仓库地址、`publishConfig` |
| `README.md` | 16.5 KB | 门面：解决的问题、特性表、界面截图、架构图、快速开始、CLI 表、MCP、同步、token 预算、安全、FAQ |
| `LICENSE` | 1.1 KB | MIT |
| `CHANGELOG.md` | 4.5 KB | Keep a Changelog 格式，0.1.0 / 0.2.0 |
| `CONTRIBUTING.md` | 2.7 KB | 开发流程、提交规范、加新工具的步骤 |
| `CODE_OF_CONDUCT.md` | 1.8 KB | 贡献者公约 |
| `SECURITY.md` | 2.1 KB | 漏洞报告方式与支持范围 |
| `.gitignore` | 0.3 KB | 排除 `node_modules/`、日志、`.env`、`tmp/`、`.skillhub-cache/` |
| `.gitattributes` | 0.1 KB | `* text=auto eol=lf`，避免 Windows 换行污染 diff |
| `.editorconfig` | 0.2 KB | 缩进/换行/编码统一 |
| `.nvmrc` | 0 KB | `v22`，本地与 CI 的 Node 版本提示 |

### 2. `src/core/`：核心逻辑（10 个文件）

纯函数 + 文件系统操作，不依赖任何第三方包。

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `index.js` | 7.6 KB | **公共门面**：`getState`、`enableSkills`、`linkAll`、`savePreferences`、`addToShelf` 等；CLI / HTTP / MCP 都只经过这里 |
| `hub.js` | 9.5 KB | 中心本体：配置读写（含 BOM 容错）、扫描技能、安装/删除、`summarize`、路径穿越防护 |
| `installer.js` | 6.3 KB | 安装源解析：`owner/repo`、GitHub URL（含 `/tree/分支/子目录`）、本地路径；codeload zip 下载与技能目录发现 |
| `importer.js` | 2.5 KB | 拖拽上传：路径校验 → 临时目录重建 → 复用 `discoverSkillDirs` + `installFromDir` |
| `linker.js` | 3.8 KB | 链接创建与**安全移除**（junction / symlink，`lstat` 守卫，绝不删真实目录） |
| `plan.js` | 4.6 KB | 先算后做：`buildPlan` / `applyPlan` / `countByAction`，支持 dry-run |
| `tools.js` | 4.0 KB | 9 个 AI 工具的技能目录注册表与自动探测；`tools` 非空时**替换**探测结果 |
| `tokens.js` | 3.3 KB | token 估算（CJK/拉丁加权）、四档分级、成本预测、预算状态 |
| `git.js` | 6.1 KB | 仓库状态（分支/remote/未提交/提交数）与一键初始化；找不到 git 时优雅降级 |
| `frontmatter.js` | 3.2 KB | 手写 YAML frontmatter 解析/改写（引号、`>`/`|` 块标量、CRLF） |
| `zip.js` | 3.5 KB | 极简 zip 解压（store + deflate，zip-slip 防护） |

### 3. `src/server/` + `src/mcp/`：对外接口（4 个文件）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `server/http.js` | 8.7 KB | HTTP 服务：静态站点、REST 路由、MCP over HTTP、CORS、token 鉴权、回环判断（决定能否"打开目录"） |
| `server/api.js` | 7.8 KB | REST 实现：`/api/state`、`/api/plan`、`/api/skills/*`、`/api/link`、`/api/install`、`/api/import`、`/api/shelf`、`/api/preferences`、`/api/git/init`、`/api/reveal` |
| `server/multipart.js` | 2.3 KB | 手写 multipart 解析（拖拽上传用，支持二进制与 CRLF） |
| `mcp/server.js` | 8.2 KB | MCP 2024-11-05：stdio + HTTP，6 个工具 + `skill://<name>` 资源 |

### 4. `src/cli.js`：命令行（1 个文件，19.7 KB）

`init` / `add` / `list` / `enable` / `disable` / `link` / `unlink` / `remove` / `show` / `serve` / `mcp` / `git` / `config` / `doctor`，含参数解析、彩色输出、`--json`。

### 5. `web/`：控制台（5 个文件，无构建）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `index.html` | 6.8 KB | 应用外壳：侧边栏、顶栏、技能抽屉、安装弹窗、命令面板、拖拽遮罩 |
| `styles.css` | 38 KB | 设计变量、亮/暗主题、全部组件（KPI、预算条、环图、卡片、表格、抽屉、palette、toast） |
| `app.js` | 48.9 KB | 状态 → 视图：五个视图、筛选/排序/布局、开关与撤销、命令面板、拖拽上传、打开目录 |
| `markdown.js` | 4.4 KB | SKILL.md 渲染（转义原始 HTML、拒绝 `javascript:`） |
| `favicon.svg` | 0.4 KB | 站点图标 |

### 6. `test/`：测试（16 个文件）

| 文件 | 大小 | 覆盖 |
| --- | --- | --- |
| `frontmatter.test.js` | 2.4 KB | 解析/改写、折叠标量、CRLF |
| `tokens.test.js` | 2.9 KB | 估算单调性、中英混合、分档、预测、预算状态 |
| `zip.test.js` | 1.9 KB | stored/deflate、目录穿越、非 zip |
| `linker.test.js` | 3.0 KB | 创建、移除、拒删真实目录、blocked/foreign |
| `hub.test.js` | 5.1 KB | 安装、列举、删除、配置往返、**BOM 容错**、源解析 |
| `plan.test.js` | 4.0 KB | 计划生成、幂等、dry-run、冲突保护 |
| `tools.test.js` | 3.0 KB | 探测规则、显式列表覆盖、目录解析 |
| `git.test.js` | 3.4 KB | 状态读取、初始化幂等、无 git 降级、remote 解析 |
| `importer.test.js` | 3.6 KB | 路径校验、嵌套技能、覆盖策略、缺 SKILL.md |
| `multipart.test.js` | 3.1 KB | 字段/文件、二进制、CRLF、畸形边界 |
| `markdown.test.js` | 3.4 KB | 标题/列表/代码/表格/转义/XSS |
| `api.test.js` | 3.9 KB | REST 路由：state、preferences、reveal、shelf、开关、404 |
| `web.test.js` | 16.7 KB | 用最小 DOM 桩**真正执行** `web/app.js`：五个视图、筛选、开关、命令面板、总目录 |
| `helpers/zip.js` | 2.0 KB | 测试用 zip 构造器（支持 deflate） |
| `fixtures/repo/skills/alpha/SKILL.md` | 0.3 KB | 示例技能 A |
| `fixtures/repo/skills/beta/SKILL.md` | 0.3 KB | 示例技能 B（折叠描述 + `disable-model-invocation`） |

### 7. `scripts/`：自检（2 个文件）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `check.js` | 3.2 KB | 全部 JS 语法、web 资源引用、`package.json` 的 bin/main/exports、README 相对链接 |
| `smoke.js` | 9.7 KB | 18 项端到端：init → 自定义工具 → add → link → list → disable → doctor → serve → 静态页 → HTTP 开关 → 预算 → 拖拽导入 → git init → CLI config/git → MCP 握手 → tools/call |

### 8. `docs/`：文档（4 个文件）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `architecture.md` | 7.3 KB | 设计目标、模块图、数据流、状态存放、成本模型、git 集成、扩展点、测试策略 |
| `tools.md` | 2.7 KB | 各 AI 工具目录矩阵与自定义接法 |
| `sync-across-devices.md` | 3.4 KB | 三种同步方案（git / MCP / 只同步名单）、冲突处理 |
| `screenshot.png` | 215.8 KB | README 用的控制台截图（1440×1200） |
| `github-upload.md` | 本文件 | 上传清单与步骤 |

### 9. `.github/`：协作与 CI（4 个文件）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `workflows/ci.yml` | 0.8 KB | Linux/Windows/macOS × Node 18/20/22/24，跑 `check` + `test` + `smoke` |
| `ISSUE_TEMPLATE/bug_report.yml` | 1.6 KB | Bug 模板（含 `skillhub doctor` 输出栏） |
| `ISSUE_TEMPLATE/feature_request.yml` | 1.1 KB | 需求模板 |
| `pull_request_template.md` | 0.7 KB | PR 自查清单 |

---

## 三、不会被上传的东西

`.gitignore` 已经排除：

```
node_modules/  dist/  coverage/  *.tsbuildinfo     # 依赖与构建产物（本项目本来就没有）
.DS_Store  Thumbs.db  desktop.ini                  # 系统垃圾
.vscode/  .idea/  *.swp                            # 编辑器
*.log  npm-debug.log*  smoke.log  tmp/             # 日志与临时文件
.env  .env.local                                   # 密钥
.skillhub-cache/                                   # 安装缓存
```

**注意**：`docs/screenshot.png`（216 KB）是**要上传的**，README 引用了它；这是仓库里唯一的二进制文件，远低于 GitHub 的 100 MB 限制。

---

## 四、上传步骤

### 方式 A：命令行（推荐）

```powershell
cd C:\Users\admin\Desktop\学习\skillhub

# 1) 先在 GitHub 网页建一个空仓库（不要勾选 README / .gitignore / LICENSE）
#    假设叫 skillhub，账号是 Uxenq

# 2) 关联远端
git remote add origin https://github.com/Uxenq/skillhub.git

# 3) 推送（分支已命名为 main）
git push -u origin main
```

如果本机 git 不在 PATH（这台机器的情况），用完整路径：

```powershell
& "C:\Users\admin\.qoder\bin\git\bin\git.exe" remote add origin https://github.com/Uxenq/skillhub.git
& "C:\Users\admin\.qoder\bin\git\bin\git.exe" push -u origin main
```

### 方式 B：网页上传（不推荐）

GitHub 的 "Add file → Upload files" 只接受拖拽，且**不能保留目录结构以外的 git 历史**。真要用：

1. 把 `skillhub` 文件夹压成 zip；
2. 网页上传时把解压后的内容整体拖进去；
3. 提交信息写 `feat: initial release`。

缺点是：CI 可能因为 `bin` 文件权限丢失而失败，且以后还得切回命令行。

### 方式 C：用 GitHub CLI（已装 gh 的话）

```powershell
gh repo create skillhub --public --source=. --remote=origin --push
```

---

## 五、推上去之后

1. **About**：填一句话描述 + 勾选 topics：`ai` `agent` `skills` `mcp` `claude-code` `codex` `cursor`。
2. **Actions**：第一次会跑 12 个矩阵任务（3 系统 × 4 Node 版本），等它变绿。
3. **Release**：`git tag v0.2.0 && git push --tags`，然后网页上发 Release，正文直接复制 `CHANGELOG.md` 的 0.2.0 段。
4. **可选：npm 发布**

   ```powershell
   npm login
   npm publish        # 包名 skillhub 若被占用，改成 @Uxenq/skillhub
   ```

5. **确认清单**
   - [ ] README 顶部徽章显示 `tests 111 passing`
   - [ ] README 里的截图能正常显示
   - [ ] Actions 全绿
   - [ ] `npx skillhub init` 能跑通（发布 npm 后）

---

## 六、常见坑

| 坑 | 说明 |
| --- | --- |
| 账号不是 `Uxenq` | `package.json` 的 `repository` / `bugs` / `homepage` 和 README 里的 clone 地址要一起改，共 4 处 |
| Windows 换行 | `.gitattributes` 已强制 LF，别删；否则 CI 上 diff 全是换行 |
| 私有仓库 | 完全可以，CI 在私有仓库同样免费额度内运行 |
| 中文路径 | 仓库放在 `C:\Users\admin\Desktop\学习\skillhub`，路径含中文；git 与 Node 都没问题，但**别把仓库放进 OneDrive 同步目录**，junction 与同步会打架 |
| 先提交再改仓库名 | 改名不影响历史，GitHub 会自动重定向旧地址 |
