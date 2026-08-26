# TOONFLOW.md — AI 短剧视频生成工作模式（从 toonflow-app 吸收）

本文档系统吸收 `/www/toonflow-app/`（生产部署）与 `~/projects/Toonflow-app/`（源码仓库）中
AI 短剧视频生成的完整工作流程、提示词体系、工作流组织与数据模式。对应原始文件已全量吸收进
本项目 `data/`（`skills/`、`modelPrompt/video/`、`vendor/`、`workflows/`），文中路径均指向本项目目录。

---

## 1. 全局架构图景

Toonflow = AI 短剧工厂。Node + Express + Socket.IO + better-sqlite3 + Vercel AI SDK（ai 包）。
web 端口 10588。Socket.IO namespace：`productionAgent`、`scriptAgent`，连接需
`auth: { token, projectId, scriptId, isolationKey }`。

两条流水线串联整部短剧的产出：

```
剧本流水线(scriptAgent)          生产流水线(productionAgent)
初始化 → 故事骨架 → 改编策略 → 剧本    导演规划 → 衍生资产分析 → 衍生资产生成(可选)
                                          → 构建分镜表 → 分镜面板写入 → 分镜图生成
```

两条流水线共用**三层 Agent 分工 + Skill 文件驱动**的模式（决策层只派发、执行层干活、
监督层只审核），只是各自的 skill 文件不同。

---

## 2. 三层 Agent 分工（两条流水线通用）

| 层 | 职责 | 红线 |
|---|---|---|
| 决策层（`runXxxAI` 主循环） | 解析用户意图、拆任务、派发执行层/监督层、展示结果、等用户决策 | 不执行具体任务；不读工作区数据（不调 `get_flowData`）；不代替 subagent 干活；执行层失败时**不得触发审核**、直接向用户汇报并结束 |
| 执行层（subagent） | 按阶段 skill 干活；先 `get_flowData` 读工作区、再 `add_*` 写入 | 只干当前阶段活、不越权；完成只回一句简短确认 |
| 监督层（subagent） | 只出审核报告，不动数据；评分 A/B/C/D | 所有依据必须经工具实际读取，不得凭记忆审核 |

要点：
- 派发指令正文**严格 ≤100 字**（脚本侧还要带【项目配置】头部）——执行层的完整规则都在 skill 文件里。
- 决策层通过 `deepRetrieve` 检索历史记忆判断进度，不靠猜。
- 监督层规则里有**缺资产不审核**：剧本出现但资产库无此基础资产 = 流程外输入、无任何阶段可新增，任何审核均不提它。

---

## 3. 剧本流水线（scriptAgent）三步

skill 文件：`data/skills/script_*.md`，决策层主 prompt `script_agent_decision.md`。

1. **项目初始化**：必须与用户确认集数 / 单集时长（语速 150 字/分）× 原著范围 × 平台规格 × 风格 × 付费策略，校验章节范围存在性。推荐分支：先问形态（微短剧/短剧/长剧）再推荐配置。
2. **阶段1 故事骨架**（`script_execution_skeleton.md`）：三幕、分集（≤20 集逐集模式A / >20 集总览+关键集模式B，模式B 表格行数必须恰 = 总集数）、约 3 个股价级反转登记、付费卡点按 10%/30%/50%/70%/90% 比例定位。输出「一集一行、无中间抽象层」。
3. **阶段2 改编策略**：提炼改编原则、删减依据、世界观呈现。
4. **阶段3 剧本编写**（逐集，≤5 集/轮）：执行层每次处理一集写入 SQLite；不需要监督层审核。

阶段1/2 串行 + 执行后自动派监督层审核，报告展示给用户、**必须等用户指示**再下一步。

---

## 4. 生产流水线（productionAgent）六阶段

skill 文件：`data/skills/production_*.md`，决策层主 prompt `production_agent_decision.md`。
六阶段必须按序：

| 阶段 | 执行层 skill | 调度工具 | 审核 |
|---|---|---|---|
| 1 导演规划 | `production_execution_director_plan.md` | `run_sub_agent_director_plan` | 否（但需用户看） |
| 2 衍生资产分析 | `production_execution_derive_assets.md` | `run_sub_agent_derive_assets` | 否，结果须展示给用户确认是否进阶段3 |
| 3 衍生资产生成(可选) | `production_execution_generate_assets.md` | `run_sub_agent_generate_assets` | 否 |
| 4 构建分镜表 | `production_execution_storyboard_table.md` | `run_sub_agent_storyboard_table` | **必须**（阶段4 完成自动派监督层） |
| 5 分镜面板写入 | `production_execution_storyboard_panel.md` | `run_sub_agent_storyboard_panel` | 否 |
| 6 分镜图生成 | `production_execution_storyboard_gen.md` | `run_sub_agent_storyboard_gen` | 否 |

阶段关键决策点：
- **阶段2→3 不可自动跳**：阶段2 结果必须展示给用户、由用户选择「全部生成/部分/跳过/调整清单」后再走。
- **阶段5 写入模式由决策层按项目"多参"参数决定**（`o_project.mode` 是否为数组 → `isRef`）：
  - 多参=是 → **纯文本多参模式**（方案A）：以分镜表「组」为写入单位、track 连续累加、不生成 prompt/分镜图。
  - 多参=否 → **首位帧模式**（方案C）：每行独立一组 track 递增、完整生成 prompt（含 `@图N` 标注）、生成分镜图。
- 分镜图/资产图生成均为**异步**，派发即返回"已启动"，不要等结果。

---

## 5. Skill 文件体系与命名规律（data/skills/）

```
skills/
├── production_agent_decision.md        # 决策层主 prompt（含流水线六阶段细则）
├── production_agent_supervision.md     # 监督层（含 4 条绝对红线 R1-R4 + 分镜表审核维度表）
├── production_execution_*.md           # 执行层各阶段（导演规划/衍生分析/资产生成/分镜表/面板/图）
├── script_agent_decision.md            # 剧本决策层
├── script_agent_supervision.md
├── script_execution_{skeleton,adaptation,script}.md
├── production_skills/                  # 通用技法（分镜表/分镜提示词）
│   ├── storyboard_table_techniques.md
│   └── storyboard_prompt_techniques.md
├── art_skills/<artStyle>/              # 美术风格库，目录名即项目 o_project.artStyle 值
│   ├── README.md                       # 风格说明 + 严禁项
│   ├── prefix.md                       # 全局美学基线（风格基因/色盘/必守 R1-R5/严禁 X1-X6）
│   ├── art_prompt/
│   │   ├── art_character.md           # 角色基础形象
│   │   ├── art_character_derivative.md # 角色变身衍生
│   │   ├── art_scene.md / art_scene_derivative.md  # 场景 / 时段衍生
│   │   ├── art_prop.md / art_prop_derivative.md    # 道具（当前不衍生）
│   │   └── art_storyboard_video.md    # 分镜画面提示词（带风格锚定词）
│   └── driector_skills/                # 导演技法（dir 拼写就是 driector，勿改）
│       ├── director_planning_style.md
│       ├── director_storyboard.md      # 分镜提示词风格专属技法-主力
│       └── director_storyboard_table_style.md
└── story_skills/<storyManual>/         # 叙事/题材库，目录名即 o_project.directorManual 值
    ├── README.md
    └── driector_skills/director_planning_narrative.md
        └── director_storyboard_table_narrative.md
```

机械约定：
- 风格类文件都带 frontmatter：`--- name / description / metaData ---`，`scanSkills` 按 `/*.md` glob 扫描后通过 `createSkillTools(mainSkills,...)` 以 `activate_skill` 工具按名激活。
- 项目选型：`o_project.artStyle` ↔ `art_skills/<artStyle>/`；`o_project.directorManual` ↔ `story_skills/<directorManual>/`。读取 `src/utils/getArtPrompt.ts`：`getArtPrompt(style, "art_skills", "art_storyboard_video")` 会自动把该风格的 `prefix.md` 拼在目标文件前。
- 已内置 11 个美术风格：2D_90s_japanese_anime / 2D_chinese_guofeng / 2D_flat_design / 2D_mature_urban_romance / 3D_anime_render / 3D_chinese_traditional / 3D_clay_stopmotion / 3D_guofeng_cyber / realpeople_ancient_chinese / realpeople_modern_city / realpeople_urban_modern；12 个题材。

---

## 6. 核心生产铁律（分镜表/导演规划/监督层共同约束）

- **台词零删改**：剧本所有引号内台词/OS/VO/系统播报/面板文字必须 100% 逐字搬运，禁合并/精简/意译。
- **时长与语速**：每个片段累计 ≤15 秒；台词按 **4 字/秒** 估算；无台词镜 ≤6 秒。
- **长台词强制拆镜**：单镜台词或 VO > 20 字必须拆多个连续镜、每镜换景别/视角、按语义停顿切；语义不可切的单镜须用表情/动作/运镜变化填满，禁单镜固定。
- **出场人物不消失**：剧本没写离场就需视觉落点（背景/局部/反应镜/虚焦剪影/前景遮挡/环境音留痕），用对应资产名代替。
- **禁光影色调**：画面描述/提示词不得出现光/影/色温/明暗/色调/逆光等词——特殊光照走场景衍生资产。
- **禁配乐**：只写环境音+动作音；BGM/氛围音乐一律不写（剧情内实体乐器物理声源除外）。
- **人物外观不进分镜提示词**：服装/发型/长相交给图片资产，只写动作/姿态/表情/当下状态。
- **XML 一次性完整输出**：`<scriptPlan>`/`<storyboardTable>` 等标签全部内容必须单次输出，禁止分多次。
- **只读引用资产**：分镜只能引用 `assets` 已存在的资产，不编造名称/ID；不调用资产写入工具。
- **片段连贯性**：动作跨片段不许"冻结跳转"，前段结尾是起始态、后段首镜是进行时/完成时；情绪要用反应镜接力；跨时空用空镜/视线引导过渡。

---

## 7. 视频提示词生成模式（data/modelPrompt/video/）

视频提示词 = 独立"视频提示词生成 Agent"（system 即该 md），输入：
**资产信息** `[id,type,name]` 列表 + **分镜信息** `<storyboardItem videoDesc='（12字段）'>`。

videoDesc 12 字段按顿号分隔：画面描述 / 场景 / 关联资产名称 / 时长 / 景别 / 运镜 / 角色动作 / 情绪 / 光影氛围 / 台词 / 音效 / 关联资产ID。

4 种模式（`batchGeneratePrompt.ts` / `generateVideoPrompt.ts` 自动匹配）：

| 模式文件 | 触发条件 | 特征 |
|---|---|---|
| `wan2.6Single-imageFirstFrameMode.md` | 模型名含 wan+2.6 | 单图首帧 |
| `seedance2Multi-parameterMode.md` | 模型名匹配 `seedance*2.0/2-0` | 多参 |
| `universalFirstAndLastFrameMode.md` | `mode` ∈ startEndRequired / endFrameOptional / startFrameOptional | 首尾帧 |
| `universalMulti-parameterMode.md` | 其他（mode 为数组 JSON） | 多参 |

匹配优先序：DB `o_modelPrompt`(vendorId+model) 绑定 > 按模型名+mode 自动匹配 > `o_prompt`(type=videoPromptGeneration) 兜底。

模式要点：
- **首尾帧模式**：提示词全英文、纯文本（**不使用 `@图N`**），五维结构 `[Visual]/[Motion]/[Camera]/[Audio]/[Narrative]`，全程单一连贯镜头（无切镜），时间轴分段 ≥1 秒（`0s-Xs`），主体标注 `speaking/silent` 防误生口型，台词保持原始语言并标注 `dialogue / inner monologue (OS) / voiceover (VO)`。景别/运镜有固定英文映射表。
- **多参模式**：使用 `@图N` 编号引用资产与分镜图（先资产后分镜图、`shouldGenerateImage=false` 的不编号），`[References]` + `[Instruction]` 结构，Instruction 全英文；角色外观/时长交给参考图与模型推断，不写。

---

## 8. Vendor 模型抽象（data/vendor/*.ts）

- 每个供应商一个模板：`{ id, version, name, models: [...] }`，VM2 沙箱执行，导出 `textRequest / imageRequest / videoRequest / ttsRequest / uploadReference / checkForUpdates`（必须挂 `exports`）。
- 模型四类：`TextModel{name,modelName,type:"text",think}`、`ImageModel{...mode:("text"|"singleImage"|"multiReference")[],associationSkills?}`、`VideoModel{...mode:VideoMode[], associationSkills?, audio, durationResolutionMap}`、`TTSModel{...voices}`。
- `VideoMode` 枚举：`"singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text" | ["imageReference:N" | "videoReference:N" | "audioReference:N"]`。`o_project.mode` 存该 mode JSON，`Array.isArray` 即多参。
- **新增/调整模型**：只改 `data/vendor/<name>.ts` 的 `models` 数组 → `yarn build && pm2 restart toonflow-app`；`o_vendorConfig.models` 只是 DB 覆盖层。
- 模型与提示词的绑定：`associationSkills` 关联美术 skill；`data/vendor/<name>.ts` 内 `modelPrompt` 由 `o_modelPrompt` 表（vendorId+model → path）或自动匹配决定。
- 密钥只写 `db2.sqlite` 的 `o_vendorConfig.inputValues`，`getHeaders()` 自动剥 `Bearer ` 前缀。
- ComfyUI vendor：`data/workflows/*.json` 工作流带 `__toonflow_meta__`（promptNodeId / referenceNodeIds / seedNodeId / resolutionNodeId / durationNodeId / voiceNodeId 等），节点 ID 即 ComfyUI `class_type` 布局。

---

## 9. 工作区数据与落库（FlowData ↔ SQLite）

`productionAgent/tools.ts` 定义唯一数据契约 `FlowData`：

```ts
{ script: string; scriptPlan: string;
  assets: AssetItem[];        // {id,name,type:role|tool|scene|clip,prompt,desc,derive[]}
  storyboardTable: string;
  storyboard: StoryboardItem[]; }
```

工具集：`get_flowData(key)`（script/scriptPlan/assets/storyboardTable/storyboard）、
`add_deriveAsset` / `del_deriveAsset` / `generate_deriveAsset({ids})` /
`generate_storyboard({ids})`、`add_flowData_storyboard({videoDesc,prompt,track,duration,associateAssetsIds,shouldGenerateImage})`。
所有操作串行队列 800ms 间隔，防并发假死。

落库链路（`add_flowData_storyboard` 为直写 DB 版，不依赖前端）：

```
o_assets (资产/衍生) ──o_assets2Storyboard──> o_storyboard ──track----> o_videoTrack
                                    o_storyboard.trackId 复用/新建 o_videoTrack.id
```

关键表：
- `o_project`: imageModel/videoModel 存 `"vendorId:modelName"`；artStyle/directorManual/mode/视频比例。
- `o_assets`: name/prompt/type/describe/assetsId(父)/imageId。
- `o_storyboard`: prompt/duration(text)/state(未生成等)/trackId/track/track/videoDesc/shouldGenerateImage/index。
- `o_videoTrack`: duration(同 track 累加)/prompt(state 生成中/已完成/生成失败)/reason。
- `o_agentWorkData`: 前端工作区数据（含 data.script/storyboard 等），与 SQLite 双写一致性靠工具调用保证。

**核心坑（代码级）**：`o_videoTrack.duration` 累加时必须**先把新行 `o_storyboard.trackId` 写回，再 SUM 该 trackId 的 duration**，否则漏算当前行。见 `tools.ts`。

---

## 10. 衍生资产规则（production_execution_derive_assets.md）

- 判断标准 = 父资产**稳定、可复用、整体级**的视觉状态变体，不是剧本重点描写、不是瞬时表情、不是局部特写。
- **角色**只提取变身状态：① 服装 ② 变身特效 ③ 变形（兽化/巨大化/缺肢）。
- **场景**只提取时间变体（日→夜/黄昏/清晨）；角度/天候/破坏不提取。
- **道具**一律不衍生。
- 每资产 1~5 条，宁缺勿滥；`name` 2~6 字体现观态；`desc` = `[与默认态的差异] · [视觉特征]`。
- 识别出后必须发生实际 `add_deriveAsset` 调用，禁止只分析不写入。

---

## 11. 运营与维护要点（/www/toonflow-app）

- 构建产物 `data/serve/app.js`（非 build/app.js）；`pm2.json` 直接指向它。
- `yarn build && pm2 restart toonflow-app` 对后端改动必做；`data/web/index.html` 改完直接生效。
- 回滚 = `git -C ~/projects/Toonflow-app pull` 取旧 commit → 重新 build + restart。
- 排障口径：`o_storyboard` 行数 vs `o_agentWorkData.data.storyboard` 长度；若 LLM 一直叙述不调工具，根因在 prompt 或 LLM 随机性，代码层无解。

---

## 12. 如何把本模式用于本项目

- 本项目（`/home/fireabyss/toonflow/`）不建脚本、不运行 toonflow 源码；已将 toonflow 的**知识资产全量吸收进本项目 `data/`**（`skills/`、`modelPrompt/video/`、`vendor/`、`workflows/`），由项目级 `opencode.json` 的 `references` 注入上下文（别名 `@skills / @modelPrompt / @vendor / @workflows`），**仅在本项目有效**。
- 写 AI 视频短剧方向的内容/脚本时直接套用：第 3 节剧本流水线 → 第 4 节六阶段 → 第 6 节铁律 → 第 7 节提示词模式；需要完整 skill 原文时读本项目 `data/skills/**`。
- 生产目录（`/www/toonflow-app/data/`）仍是**最新事实源**：本项目 `data/` 是其快照，如需最新改动以生产目录为准并同步回来。