# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-11-05

控制台重做，并把「省 token」从一句口号变成可度量的仪表；新增拖拽导入与 git 同步面板。

### Added

- **控制台重做**：侧边栏五视图（概览 / 全部技能 / 来源 / 同步 / 设置），KPI 卡片、预算条、构成环图、最贵技能排行、工具接入状态。
- **全部技能索引**：概览页直接列出中心里的每一个技能（名字一屏看全，虚线表示未上架），点开即看 SKILL.md；空中心会明确提示当前路径与 `--hub` 用法。
- **空中心提示**：`skillhub serve` 在中心为空时打印警告与 `--hub` 建议，避免"打开了但什么都没有"。
- **目录预算**：`budget`（默认 2000 tokens）与 `dailyRequests`（默认 100）写入 `skillhub.json`；超过 80% 变黄、100% 变红。
- **成本预测**：每轮 / 每天 / 每月三档换算；每个技能按开销分 轻 / 中 / 重 / 极重 四档。
- **命令面板**：`Ctrl/⌘ K` 搜索技能、跳转视图、执行动作；`/` 聚焦搜索框。
- **拖拽导入**：把技能文件夹拖进窗口即可安装，服务端用自写 multipart 解析 + 临时目录重建，再走与 `skillhub add` 相同的路径。
- **git 同步**：`skillhub git [init|status]` 与 `POST /api/git/init`，写 `.gitignore`、首提交、展示分支/remote/未提交改动；git 不存在时优雅降级。
- **偏好设置**：`skillhub config [budget|requests] [值]`、`POST /api/preferences`。
- **视图深链**：视图写进 URL hash（`#/skills`），可分享、刷新保持。
- **撤销**：每次上架/下架都有「撤销」按钮。
- **网格 / 表格**双布局，按名称/开销/更新时间排序。
- **打开总目录**：侧边栏「总目录」按钮、概览页路径胶囊、抽屉里的技能路径，点一下在文件管理器中打开（`POST /api/reveal`，仅回环地址会真的打开，远端自动降级为复制路径）。
- **安装即上架**：新装的技能自动进入上架名单（原本下架状态不受影响）。
- **测试**：101 个单元测试（新增 git、multipart、importer、分档与预测）+ 18 项端到端检查。

### Changed

- 控制台由单页列表改为侧边栏多视图；设计变量统一到 `web/styles.css` 顶部，暗色模式只做一次覆盖。
- `publicState` 增加 `budget`、`dailyRequests`、`projection`、`savings`、`spenders`、`tiers`、`git`、`version`，每个技能增加 `tier` 与 `onShelf`。
- `skillhub add` 与安装 API 会把新技能加入上架名单。

### Fixed

- `skillhub.json` 保存时丢失 `budget` / `dailyRequests`。
- 前端测试用的 DOM shim 支持 `replaceChildren`、后代选择器与 `textContent` 拼接，能真正跑通新控制台。

## [0.1.0] - 2026-11-05

首个可用版本。

### Added

- **中心与链接**：技能只存一份，通过 Windows junction / POSIX symlink 接入各 AI 工具目录。
- **上架 / 下架**：`shelf` 名单控制哪些技能出现在模型目录中，下架不影响技能本体。
- **安装**：`skillhub add` 支持 `owner/repo`、GitHub URL（含 `/tree/分支/子目录`）和本地文件夹；走 codeload zip，无需 git 与 token。
- **可视化控制台**：搜索、筛选（全部/已上架/未上架/斜杠命令）、开关、SKILL.md 预览、一键安装；浅色/深色跟随系统。
- **REST API**：`/api/state`、`/api/plan`、`/api/skills/:name`、`/api/skills/:name/{enable,disable,remove}`、`/api/link`、`/api/install`、`/api/shelf`。
- **MCP 服务**：`skillhub mcp`（stdio）与 `POST /mcp`（HTTP），提供 `list_skills`、`read_skill`、`enable_skill`、`disable_skill`、`install_skill`、`link_tools` 与 `skill://<name>` 资源。
- **token 估算**：按 CJK/拉丁字符加权估算目录开销，控制台与 CLI 均展示。
- **安全默认值**：仅监听回环；绑定局域网时自动生成写操作 token；移除链接前校验 `lstat`；zip 解压防目录穿越。
- **自检**：`skillhub doctor` 检查中心、工具、断链与冲突；`scripts/check.js` 做语法与元信息自检。
- **测试**：67 个 `node:test` 单元测试（含前端 DOM 渲染测试）+ 13 项端到端冒烟检查。

[Unreleased]: https://github.com/xingaorpw/skillhub/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/xingaorpw/skillhub/releases/tag/v0.2.0
[0.1.0]: https://github.com/xingaorpw/skillhub/releases/tag/v0.1.0
