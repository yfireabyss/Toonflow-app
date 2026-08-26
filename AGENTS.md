# AGENTS.md

本仓库所有项目文件、思考过程与答复**默认一律使用中文**写就。除非用户明确要求，不要输出英文注释、英文 commit message 或英文答复。

## 工作区定位（最容易搞错）

当前目录 `/home/fireabyss/toonflow/` **不是源码目录**，仅作指令落点（含 `package.json` 声明的 socket.io-client 依赖）。真正的项目：

> **AI 视频短剧工作模式**见 `TOONFLOW.md`（从 toonflow-app 吸收的流水线/提示词/数据模式，写作与二次开发前必读）

| 路径 | 角色 |
| --- | --- |
| `/www/toonflow-app/` | 生产部署：`src/`、`data/`（SQLite/OSS/前端静态）、`node_modules`、pm2 进程 `toonflow-app` |
| `~/projects/Toonflow-app/` | 源码 Git 仓库：branch `main`，remote 为 GitHub |
| 当前目录 | Git 仓库（origin = toonflow-ctrl）+ 指令落点 + **AI 短剧制作知识资产库**（`data/`）；**不要**在这里建脚本 |

## 本项目知识资产库（从 toonflow 吸收，仅本项目 git 有效）

opencode 已配置项目级 `references`（见 `opencode.json`），下述目录只在本项目内提供上下文，不污染其他项目：

| reference 别名 | 目录 | 内容 |
| --- | --- | --- |
| `@skills` | `data/skills/` | 生产/剧本流水线执行层 skill、`art_skills/` 11 个美术风格、`story_skills/` 12 个题材、`production_skills/` 技法 |
| `@modelPrompt` | `data/modelPrompt/video/` | 视频提示词 4 模式（wan2.6 首帧 / seedance2 多参 / 通用首尾帧 / 通用多参） |
| `@vendor` | `data/vendor/` | 供应商模型配置模板（各模型 type/mode/支持能力） |
| `@workflows` | `data/workflows/` | ComfyUI 工作流目录规范与 `__toonflow_meta__` 约定 |

- 吸收来源是生产目录快照；如需 toonflow 最新改动，对照 `/www/toonflow-app/data/` 对应目录。
- 右上角这些目录是**知识参考**，不是可运行源码（数据库、密钥、运行逻辑仍在 toonflow-app）。

## 代码变更流程（强制顺序）

1. 改源码 → 只在 `~/projects/Toonflow-app/src/` 改
2. 提交推送 → `git add && git commit && git push`（只提交 src、data/vendor 模板等源码，**绝不提交 `data/serve/app.js`、API Key、`db2.sqlite`**）
3. 部署 → 同步到 `/www/toonflow-app/`（复制文件 / rsync / git pull）
4. 构建重启 → 后端改动必须 `yarn build && pm2 restart toonflow-app` 才生效
5. 失败 → 回滚 = `git -C ~/projects/Toonflow-app pull` 取旧 commit，再重新 build + restart

> 永远不要直接改 `/www/toonflow-app/src/`，pm2 跑的是构建产物，下次 build 会被覆盖。

## 关键命令（工作目录 `/www/toonflow-app`）

```bash
yarn build                                 # 输出 data/serve/app.js（不是 build/app.js，脚本日志会误导）
pm2 restart toonflow-app
pm2 logs toonflow-app --lines 50 --nostream
yarn lint                                  # 实际就是 tsc --noEmit
yarn dev                                   # nodemon + tsx + inspect 本地开发
```

前后端改动差异：`data/web/index.html` 改完**直接生效**，不需要 build、不需要 restart（改前先备份，历史上出现过 `.bak-*`）。后端改动必须 build + restart。

## 架构要点（写代码前必看）

- 入口 `src/app.ts`：Express HTTP + 多个 Socket.IO namespace
- web 服务端口 10588；Socket.IO namespace：`productionAgent`（决策层+执行层，前端 `addStoryboard` 事件源）、`scriptAgent`；连接需 `auth: { token, projectId, scriptId, isolationKey }`
- HTTP 路由：`src/router.ts` 挂载 `src/routes/**` 到 `/api/<subpath>/<action>`（如 `/api/project/addProject`、`/api/setting/vendorConfig/getVendorList`）
- **Vendor 抽象**：`data/vendor/*.ts`（deepseek/openai/minimax/klingai/volcengine/…），源码在 VM2 沙箱执行。新增或调整模型：只改对应 vendor 模板的 `models` 数组，再 build + restart；`o_vendorConfig.models` 仅作 DB 覆盖
- vendor 模板导出约束：`exports.textRequest / imageRequest / videoRequest / ttsRequest / uploadReference / checkForUpdates`，必须挂 `exports`，禁止 `export default`
- 密钥只写 `data/db2.sqlite` 的 `o_vendorConfig.inputValues`，绝不进 vendor 模板或 git；`getHeaders()` 自动剥 `Bearer ` 前缀
- 数据落点：SQLite `/www/toonflow-app/data/db2.sqlite`、资产 `data/assets/`、OSS 缓存 `data/oss/`、工作流 `data/workflows/`、模型 prompt `data/modelPrompt/`、skills `data/skills/`

## 常见坑

- `yarn build` 产物路径是 `data/serve/app.js`；`pm2.json` 直接指向它
- `o_videoTrack.duration` 同 track 累加时，必须先写回新行 `trackId` 再 SUM，否则漏算当前行
- 数据库行数校验：`o_storyboard` 行数 vs `o_agentWorkData.data.storyboard` 数组长度；LLM 一直叙述不调工具时，根因在 prompt / LLM 随机性，代码层面无解
- `/www/toonflow-app/` 与当前会话同用户（uid/gid 1000），可直接读写；SQLite 文件 644、目录 775，写新表前先确认写权限

## 临时脚本规则（强制）

**禁止**在当前目录 `./` 创建任何临时脚本（`.sh`/`.py`/`.mjs`/`.js`/`.ts`）。所有临时脚本一律放 `/tmp/toonflow/YYYY-MM-DD/<脚本名>`（当天日期目录），落盘前 `mkdir -p /tmp/toonflow/$(date +%F)`。`package.json`、`yarn.lock`、`node_modules/` 是依赖声明，不算临时脚本。

## 正式输出落盘规则（强制）

正式输出的**内容、文件、代码**一律放在 `./<分类目录>/YYYY-MM-DD/` 下（`mkdir -p ./<分类>/$(date +%F)`）。

- 分类目录按主题划分，常用：`analysis/`（分析报告）、`docs/`（文档）、`reports/`（运维/排查报告）、`research/`（调研）等
- 日期格式严格 `YYYY-MM-DD`（按当天本地日期）
- 同一天多次落盘全部进同一日期目录，便于事后整理
- 与"临时脚本"分工：**临时脚本放 `/tmp/toonflow/YYYY-MM-DD/`**，**正式输出放 `./<分类>/YYYY-MM-DD/`**，两者不可混用