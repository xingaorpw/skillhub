# 维护手册

这个项目按**每周一次**的节奏维护。本文写给未来的维护者（通常就是我自己），
也写给想参与的人：你能看到维护者每周到底在做什么。

## 每周的「优化与创新」（不只是修 bug）

维护的下限是「不坏」，上限是「变得更好」。所以每周固定留一段时间做**一项**改进，而不是等灵感。

**规则**（三条，缺一不算数）：

1. **有数字**：性能、token、点击次数、行数、构建时间——改完能说出前后差多少。说不出数字的改动是「感觉更好」。
2. **可回滚**：一次只改一件事，能 `git revert` 回上一条。
3. **写进 CHANGELOG**：用户在「Added / Changed」里能看懂发生了什么。

**找改进点的四个地方**（按性价比排序）：

| 来源 | 例子 |
| --- | --- |
| 自己用起来别扭的地方 | 「想知道该砍哪个技能」→ 预算规划器 |
| 指标能算出差距的地方 | 目录开销 vs 预算、CI 时长、首次启动耗时 |
| 别人成熟项目的做法 | 命令面板、撤销、深链接、预算条——都是抄来的 |
| 现有功能的「下一步」 | 能看成本 → 能算出怎么省（就是这一周的交付） |

**已经落地的例子**：0.2.x 的预算规划器（`skillhub tune` / 控制台「预算规划」卡片）——它把「你这轮超了 382 tokens」变成「下架这 7 个、每轮省 382、剩 51 个」，从仪表变成工具。

## 定期回顾：Roadmap 与「删代码」

每月顺手做两件事：

- **删**：三个月没人碰的功能、只在一种操作系统上跑的分支、为了兼容已放弃的版本写的 shim。
- **挪**：[ROADMAP.md](../ROADMAP.md) 里超过两个月没动的条目，要么排期，要么挪到「以后再说」并写清原因。

## 节奏

| 频率 | 做什么 | 预计耗时 |
| --- | --- | --- |
| **每周一** | 看 CI、处理 issue/PR、复查 Roadmap、记 CHANGELOG | 15 分钟 |
| **每月** | 合并 Dependabot 的 action 升级、校对 README 与截图、按需发版 | 30 分钟 |
| **每季** | 复查安全策略（`SECURITY.md`）、调整支持版本、清理长期不动的 issue | 1 小时 |

## 每周清单

1. **拉最新代码并本地自检**

   ```powershell
   cd C:\Users\admin\Desktop\学习\skillhub
   git pull
   npm test          # 112 个单元测试
   npm run smoke     # 18 项端到端
   npm run check     # 语法 / 元数据 / README 链接
   ```

2. **看 Actions 是不是绿的** —— <https://github.com/xingaorpw/skillhub/actions>
   红了当天修，不留过夜。矩阵覆盖 Ubuntu / Windows / macOS × Node 18 / 20 / 22 / 24。

3. **看 Dependabot 的 PR** —— 每周一自动开，检查 `actions/checkout`、`actions/setup-node` 的版本。
   绿色就合并；红色说明新版 action 有不兼容，先看它的 release notes。

4. **分诊新 issue / PR** —— 打标签：`bug` / `enhancement` / `question` / `good first issue`。
   Bug 优先要 `skillhub doctor` 的输出和系统信息（issue 模板里已经要求了）。

5. **记 CHANGELOG** —— 本周有任何面向用户的改动，就在 `## [Unreleased]` 下按
   Added / Changed / Fixed / Removed 记一条。**不要**等发版时才回忆。

6. **复查 [ROADMAP.md](../ROADMAP.md)** —— 完成的从「正在做」删掉（它已经在 CHANGELOG 里了），
   被 issue 推翻的计划挪到「以后再说」，并更新文件顶部的「最后更新」日期。

7. **该发版就发版** —— 见下面的流程。

## 发版流程

```powershell
# 1) Unreleased 变成正式段落：## [x.y.z] - YYYY-MM-DD
# 2) 升版本号（不自动打 tag，我们要自己写 tag message）
npm version minor --no-git-tag-version

# 3) 补 CHANGELOG 底部的 compare 链接
# 4) 提交、打 tag、推送
git add -A
git commit -m "chore(release): x.y.z"
git tag -a vx.y.z -m "SkillHub x.y.z"
git push --follow-tags

# 5) 网页上发 Release，正文复制 CHANGELOG 对应段落
# 6) 需要发 npm 时（可选）
npm publish
```

版本号约定（语义化版本）：

- **patch**：修 bug、改文档、升级依赖
- **minor**：新功能、新命令、新 API（向后兼容）
- **major**：改配置格式、删命令、破坏性行为

## 已经自动化的部分

| 项 | 触发 | 说明 |
| --- | --- | --- |
| CI 矩阵 | 每次 push / PR | 3 系统 × 4 个 Node 版本，跑 check + test + smoke |
| 定时 CI | 每周一 03:00 UTC | 没有提交也会跑，用来发现「Node 新版本把测试跑挂」这类外部变化 |
| Dependabot | 每周一 | 检查 GitHub Actions 的版本 |
| 本地自检 | 手动 | `npm test` / `npm run smoke` / `npm run check`，合计约 60 秒 |

## 排障顺序

1. **CI 红了** → 看是哪个 job、哪一步 → 本地 `node scripts/test.js` 复现
2. **测不通但本地是绿的** → 多半是平台差异（路径分隔符、大小写、git 身份），
   在 `test/` 里补一个跨平台用例，而不是改 CI 绕过去
3. **推不上去** → 这台机器 `github.com:443` 被墙，但 SSH 的 22 端口是通的；
   如果 22 也不行，用 `~/.ssh/config` 里注释掉的 `ssh.github.com:443` 配置
4. **找不到原因** → 开 issue，附 `skillhub doctor` 的完整输出

## 维护者的承诺

- issue 一般 **7 天内**首次回复
- 安全报告按 [SECURITY.md](../SECURITY.md) 走私密渠道，**48 小时内**确认
- 不支持 Node < 18.17；`engines` 字段已经写死在 `package.json` 里
