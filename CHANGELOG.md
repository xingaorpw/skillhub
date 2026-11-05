# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/your-name/skillhub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-name/skillhub/releases/tag/v0.1.0
