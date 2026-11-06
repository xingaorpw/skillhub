# 贡献指南

感谢愿意花时间。这个项目刻意保持小：**没有依赖、没有构建、没有框架**。请先读一遍 [架构文档](./docs/architecture.md)，再动手。

## 环境

- Node.js ≥ 18.17（`node --version`）
- 不需要 `npm install`

## 本地验证

```bash
node scripts/test.js        # 单元测试
node scripts/check.js             # 语法 / web 资源 / package 元信息 / README 链接
node scripts/smoke.js             # 端到端：CLI → 链接 → HTTP → MCP
```

三条都通过再提 PR。CI 会在 Linux / Windows / macOS 上跑同样的命令。

## 代码约定

- **ESM only**，`import` 带 `.js` 后缀。
- **零运行时依赖**。想加包之前，先开 issue 说明为什么内置模块做不到。
- **破坏性操作必须可证明**：删除前 `lstat` 校验，写入前检查路径在目标目录内。
- **先算后做**：涉及文件系统的批量改动，走 `plan.js` 的计划对象，支持 `--dry-run`。
- **注释解释「为什么」**，不复述代码在做什么。
- 错误信息用英文（便于检索），面向用户的文档用中文。

## 提交信息

Conventional Commits：

```
feat(tools): 支持 Zed 的 skills 目录
fix(linker): 移除 junction 时不再回退到 unlink
docs(readme): 补充 MCP 远程用法
test(plan): 覆盖 foreign 链接不被删除
```

## 新增一个工具的支持

只需要在 `src/core/tools.js` 的 `TOOL_REGISTRY` 加一行：

```js
{ id: 'zed', label: 'Zed', dir: '.zed/skills', create: false },
```

并在 `docs/tools.md` 的表格里补一行。`create: false` 表示「目录存在才接管」，避免给没装这个工具的人凭空建目录。

## 新增一个 MCP 工具

1. 在 `src/mcp/server.js` 的 `TOOLS` 里加声明（含 `inputSchema`）；
2. 在 `callTool` 的 `switch` 里实现；
3. 复用 `core/index.js` 的现有函数，不要在 MCP 层写业务逻辑。

## 新增一个 REST 接口

在 `src/server/api.js` 的 `handleApi` 里加分支，返回 `{ status, json }`；写操作记得返回最新的 `publicState()`。

## 前端改动

`web/` 下是原生 HTML/CSS/JS，没有构建步骤。改完直接刷新页面即可。请保持：

- 颜色、圆角、阴影走 `:root` 的 CSS 变量，不写死色值；
- 深色模式通过 `prefers-color-scheme` + `data-theme` 同时生效；
- 交互元素可键盘操作，有可见焦点；
- 不引入任何前端框架或 CDN 资源。

## PR 检查清单

- [ ] 测试通过（三条命令）
- [ ] 新行为有对应测试
- [ ] 用户可见的变更更新了 README 或 `docs/`
- [ ] `CHANGELOG.md` 的 `Unreleased` 下加了一条
- [ ] 没有提交 `node_modules`、临时文件、个人路径
