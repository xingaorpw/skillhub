# 跨设备同步

中心的全部状态就是「一个文件夹 + 一个 `skillhub.json`」，所以同步方案可以很朴素：**用 git**。

## 方案 A：git 托管中心（推荐）

### 第一台机器

```bash
cd ~/.skillhub
skillhub git init      # = git init -b main + 写 .gitignore + 首次提交
                       #   控制台「同步」页有同样的按钮
# 在 GitHub 建一个空仓库（私有即可），然后
git remote add origin git@github.com:you/my-skills.git
git push -u origin main
```

不想用 CLI 也行，手敲等价命令：

```bash
git init -b main && git add . && git commit -m "chore: initial skills"
```

### 第二台机器

```bash
git clone git@github.com:you/my-skills.git ~/.skillhub
cd ~/.skillhub
skillhub link        # 关键一步：按当前路径重建所有链接
skillhub doctor      # 确认没有 blocked / broken
```

### 日常

```bash
cd ~/.skillhub
git pull && skillhub link     # 拿到别人的改动
# 装/改技能后
git add -A && git commit -m "feat: add pdf-explore" && git push
```

### 为什么必须 `skillhub link`

链接内部存的是**绝对路径**：

```
C:\Users\admin\.dsh\skills\tdd  →  C:\Users\admin\.skillhub\tdd
```

换一台机器，用户名或路径不同，旧链接就断了（`doctor` 会报 broken）。`skillhub link` 会按当前机器的真实路径重算并修复，且是幂等的——跑几次都一样。

## 方案 B：MCP 远程共享（不落地）

不想在每台机器上存一份，可以让远端设备直接通过 MCP 用主机的技能库：

```bash
# 主机
skillhub serve --host 0.0.0.0
# 记下打印出来的 token
```

```bash
# 远端：读技能列表
curl -s http://192.168.1.10:4711/mcp \
  -H 'content-type: application/json' \
  -H 'x-skillhub-token: <token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}'
```

```bash
# 远端：取某个技能的全文，喂给模型
curl -s http://192.168.1.10:4711/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_skill","arguments":{"name":"tdd"}}}'
```

适合「主机常开、其他设备只是借用」的场景。注意：

- 只暴露 `POST /mcp` 与只读 `GET /api/*`；写操作要 token。
- 没有做 SSE 流式传输，是「一问一答」的 JSON-RPC，够用且实现简单。
- 公网暴露请套一层反向代理 + TLS，别直接 `--host 0.0.0.0` 上公网。

## 方案 C：只同步「上架名单」

技能本体可能很大（PDF 模板、字体、示例数据），而真正影响行为的是 `skillhub.json` 里的 `shelf`。

```bash
# 只把这一个文件纳入版本管理
cd ~/.skillhub
echo '*' > .gitignore
echo '!skillhub.json' >> .gitignore
```

另一台机器上手工放好技能目录，克隆这个仓库到 `~/.skillhub` 后再 `skillhub link`。

## 建议的 `.gitignore`

```gitignore
.DS_Store
Thumbs.db
*.log
.skillhub-cache/
```

不要忽略技能目录本身——那是你要同步的东西。若某些技能含密钥或本地路径，单独排除：

```gitignore
my-private-skill/
```

## 冲突处理

`skillhub.json` 是唯一容易冲突的文件（两个人同时改上架名单）。它是纯 JSON 数组，冲突时保留并集即可：

```bash
git pull   # 冲突
# 手工合并 shelf 数组，保留双方都想要的技能
git add skillhub.json && git commit
skillhub link
```
