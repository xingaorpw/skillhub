# 工具矩阵

SkillHub 只做一件事：把「技能的目录」和「工具的扫描目录」连起来。所以支持一个工具 = 知道它扫哪个目录。

## 内置支持

| id | 工具 | 技能目录 | 默认建目录 |
| --- | --- | --- | --- |
| `dsh` | DeepSeek Harness | `~/.dsh/skills` | 是 |
| `claude` | Claude Code | `~/.claude/skills` | 是 |
| `codex` | Codex CLI | `~/.codex/skills` | 是 |
| `cursor` | Cursor | `~/.cursor/skills` | 否 |
| `workbuddy` | WorkBuddy | `~/.workbuddy/skills` | 否 |
| `qoder` | Qoder | `~/.qoder/skills` | 否 |
| `windsurf` | Windsurf | `~/.windsurf/skills` | 否 |
| `gemini` | Gemini CLI | `~/.gemini/skills` | 否 |
| `opencode` | opencode | `~/.config/opencode/skills` | 否 |

「默认建目录」为「否」的工具，只有在目录已经存在时才会被探测到——避免为一个你没装的工具凭空造一个 `~/.cursor`。

探测规则（`detectTools`）：

1. 目录已存在 → 纳入；
2. 目录不存在，但父目录存在且该工具标记 `create: true` → 纳入（首次运行时创建）；
3. 其它情况 → 忽略。

## 接入一个未内置的工具

在中心的 `skillhub.json` 里加 `tools`：

```json
{
  "version": 1,
  "shelf": null,
  "tools": [
    { "id": "my-tool", "label": "My Tool", "dir": "~/Library/Application Support/MyTool/skills", "create": true }
  ]
}
```

> ⚠️ **一旦 `tools` 非空，它就代表完整列表**：内置的自动探测会被关闭，只有你列出的工具会被链接。这是故意的——脚本化运行时不应该碰到用户没点名的目录。想保留内置工具，把它们一并列出来。

`dir` 支持 `~`、绝对路径、或相对家目录的路径。

## 目录布局约定

SkillHub 假设目标工具满足：

```
<技能目录>/<技能名>/SKILL.md
```

即「每个技能一个文件夹，文件夹里有 `SKILL.md`」。这是 Claude Code 的 skills 约定，也是目前事实上的跨工具标准。如果你的工具用单文件（如 `.md` 平铺），SkillHub 目前不支持——需要链接整目录而非单文件。

## 不接管的应用管理目录

有些工具会自己管理插件目录并在升级时覆盖，把链接放进去会被清掉或引发冲突。典型例子：

| 路径 | 为什么不管 |
| --- | --- |
| `~/.codex/skills/.system` | Codex 自带的系统技能，升级时重建 |
| `~/.cursor/skills-cursor` | Cursor 内置技能 |
| `~/.workbuddy/plugins/**` | 多版本并存的插件目录 |
| `~/.vscode/extensions/**` | 扩展包，不是技能 |
| `~/.qoder/security-resources` | 应用私有资源 |

这些目录里的东西仍然可以**收编**进中心（复制进来统一管理），但不要反向链接回去。
