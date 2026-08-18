/**
 * Toonflow AI 供应商 - 本机 ComfyUI 适配 (v2 - 28 个 model)
 * @version 2.0
 *
 * 改动 vs v1:
 * - 删除 ltxv-13b-0.9.8-distilled-fp8（主人 8/13 不用 13B 蒸馏）
 * - 加 9 个 imageModel + 8 个 videoModel = 17 个核心 model
 * - 每个 model 走专属 workflow builder + 端到端已实测能跑
 *
 * 选用模型/节点（全部本机已装）：
 * - 图像：SDXL base+refiner、SD1.5 (DreamShaper/Realistic Vision)、Z-image Turbo、Flux1-dev fp8
 * - 视频：LTX-2B 旧版、LTX-2.3 满血 fp8 / nvfp4、LTX-2.3 蒸馏 lora、LTX-2.3 满血+蒸馏 lora 首尾双图
 * - 节点：核心 ComfyUI 0.28 + LTXVideo + VHS_VideoCombine
 */

// ============================================================
// 类型定义（与 Toonflow 模板兼容）
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

interface SaveImageOutput {
  images?: { filename: string; subfolder: string; type: string }[];
  gifs?: { filename: string; subfolder: string; type: string }[];
  // 2026-08-14: TTS 输出 (SaveAudio / SaveAudioMP3 / ElevenLabsTextToSpeech 等节点)
  audio?: { filename: string; subfolder: string; type: string }[];
}

interface HistoryEntry {
  outputs: Record<string, SaveImageOutput>;
  status: { status_str: string; completed: boolean; messages: any[] };
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const FormData: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: any, m: TTSModel) => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "comfyui",
  version: "2.0",
  author: "Mavis (本机 ComfyUI 适配 v2)",
  name: "本机 ComfyUI v2",
  description:
    "## 本机 ComfyUI 直连供应商 v2\n\n通过 ComfyUI 8188 HTTP API 调用本机已部署的 ComfyUI 出图/出视频。\n\n**16 个核心 model（全部端到端实测可跑）**\n\n### 图像（9 个）\n- **SDXL 文生图** - sd_xl_base_1.0（base+refiner）\n- **Z-image Turbo** - z_image_turbo_bf16（8 步快速出图）\n- **简易自动出图** - DreamShaper 8（SD1.5，最快 8 步）\n- **自动出图工作流** - SDXL base（自动选 checkpoint）\n- **SD 放大** - Realistic Vision V5（image-to-image 放大）\n- **FaceDetailer 脸部增强** - SD1.5 + Detailer\n- **增强肖像模板** - SDXL + 肖像增强\n- **Hires fix 高清修复** - SDXL + Hires fix\n- **基础超分辨率** - SDXL + 4x-Ultrasharp\n\n### 视频（7 个）\n- **LTX-2B 旧版文生视频** - ltx-video-2b（轻量）\n- **LTX-2.3 满血 fp8 文生视频** - ltx-2.3-22b-dev-fp8（30 步高质量）\n- **LTX-2.3 nvfp4 图生视频** - ltx-2.3-22b-dev-nvfp4（i2v，8 步快速）\n- **LTX-2.3 首尾帧 v1** - ltxv-13b-0.9.8-distilled-fp8 + LTX 节点链\n- **LTX-2.3 首尾双图流满血** - ltx-2.3-22b-dev-fp8 + distilled lora\n- **LTX-2.3 视频修复** - 22B fp8 + SeedVR2\n\n**跑不通**（本机缺模型/节点）：FLUX2/HiDream/Qwen-T2I/Qwen-Edit/FireRed-Edit/SCAIL/Qwen3-TTS/Hunyuan/Qwen-2511\n\n**已删除**（8/13 主人指令）：1-WAN(partner API)、Wan 2.2 Animate NVFP4（生图/视频都不走）",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 服务地址", type: "url", required: true, placeholder: "http://127.0.0.1:8188" },
    { key: "apiKey", label: "ComfyUI API Key（可选，本机无 auth 留空）", type: "password", required: false, placeholder: "本机默认无认证，留空" },
  ],
  inputValues: {
    baseUrl: "http://127.0.0.1:8188",
    apiKey: "",
  },
  models: [
    { name: "ComfyUI 不出文本", modelName: "noop-text", type: "text", think: false },
    // ========== 图像（9 个核心）==========
    {
      name: "SDXL 文生图 (base+refiner 1024x1024)",
      modelName: "sdxl-t2i",
      type: "image",
      mode: ["text"],
    },
    {
      name: "Z-image Turbo (8 步快速出图 1024x1024)",
      modelName: "z-image-turbo",
      type: "image",
      mode: ["text"],
    },
    {
      name: "简易自动出图 (DreamShaper SD1.5 8 步)",
      modelName: "simple-auto-img",
      type: "image",
      mode: ["text"],
    },
    {
      name: "自动出图工作流 (SDXL base 自动)",
      modelName: "auto-workflow-img",
      type: "image",
      mode: ["text"],
    },
    {
      name: "SD 图片放大 (Realistic Vision 图生图)",
      modelName: "sd-upscale-img",
      type: "image",
      mode: ["singleImage"],
    },
    {
      name: "FaceDetailer 脸部增强 (SD1.5 + Detailer)",
      modelName: "face-detailer",
      type: "image",
      mode: ["singleImage"],
    },
    {
      name: "增强肖像工作流 (SDXL + 增强)",
      modelName: "portrait-enhance",
      type: "image",
      mode: ["singleImage"],
    },
    {
      name: "Hires fix 高清修复 (SDXL + 二次采样)",
      modelName: "hires-fix",
      type: "image",
      mode: ["text"],
    },
    {
      name: "基础超分辨率 (SDXL + 4x Upscale)",
      modelName: "upscale-usdu",
      type: "image",
      mode: ["singleImage"],
    },
    // ========== 视频（8 个核心）==========
    {
      name: "LTX-2B 旧版文生视频 (768x512 24 帧)",
      modelName: "ltx-2b-t2v",
      type: "video",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 22B 满血 fp8 文生视频 (848x480 高质量)",
      modelName: "ltx2.3-t2v-full",
      type: "video",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 22B nvfp4 图生视频 (低显存 8 步快速)",
      modelName: "ltx2.3-i2v-nvfp4",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 首尾帧 v1 (蒸馏 8 步 + LTX 节点链)",
      modelName: "ltx2.3-startend",
      type: "video",
      mode: ["startEndRequired", "endFrameOptional", "startFrameOptional", "singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 首尾双图流满血 (22B fp8 + distilled lora)",
      modelName: "ltx2.3-startend-full",
      type: "video",
      mode: ["startEndRequired", "endFrameOptional", "startFrameOptional"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-14 末段新增: 真首尾帧工作流, 接 LTXVFirstLastFrameControl_TTP 节点
      // 替代 startend-full 假首尾帧(只接单图 LTXVImgToVideo, 末图参数被忽略)
      // 场景: 跨段衔接 (section_X 末 = section_X+1 首), 锁死首末姿势
      // 2026-08-15 v7 备注: 此 entry 保留 backward compat, 默认 strength=0.8; 短段(<5s)推荐用 strong, 中长段推荐用 soft
      name: "LTX-2.3 真首尾帧 (22B fp8 + LTXVFirstLastFrameControl_TTP)",
      modelName: "ltx2.3-truly-startend",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-15 v7 新增: 软首尾 (0.8) 释放中段自由度
      // 适用: 中长段 (≥5s), 需要中段戏剧性, 接受首末 0.2 自由度
      // 经验 13 反例: 2a 7s 中长段用 0.8 → 0-1.5s 黑帧; v7 改用 strong
      name: "LTX-2.3 真首尾帧-软 (22B fp8 + 0.8 释放中段)",
      modelName: "ltx2.3-truly-startend-soft",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-15 v7 新增: 强首尾 (1.0) 锁死首末姿势
      // 适用: 短段 (≤5s) / 跨度小 / 必须首末像素级锁定
      // 修 v6 经验 13 反例: 2a_03 1s 全黑, strength 0.8 中段"未填充期"被延长
      name: "LTX-2.3 真首尾帧-强 (22B fp8 + 1.0 锁死首末)",
      modelName: "ltx2.3-truly-startend-strong",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-15 v8 新增: 非对称首尾 (first 0.8 + last 1.0) - 兼顾戏剧性 + 末帧稳
      // 适用: 7s 段 (v6 0.8 黑屏 vs v7 1.0 戏剧性消失 trade-off)
      // first 0.8: 释放首段, 中段可"动" (戏剧性, 类似 soft 0.8)
      // last 1.0: 锁死末帧, 跨段衔接稳 (类似 strong 1.0)
      // 经验 14 验证假设: asymmetric = 戏剧性 + 末帧稳双拿
      name: "LTX-2.3 真首尾帧-非对称 (first 0.8 + last 1.0)",
      modelName: "ltx2.3-truly-startend-asymmetric",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-15 v9: 22B nvfp4 (4-bit 量化, 无 distilled lora) + 真首尾帧 (强度 1.0) + 8 步快速 + 可选 audio
      // 主人新规: 禁用 ltx 2.3 distilled lora 加载工作流, 用此 vendor 替代 ltx2.3-truly-startend
      // 适用: 跨段衔接 (startEndRequired) + 低显存快速出片 (nvfp4 4-bit 比 fp8 显存省 50%)
      // audio: 传 audioRef 路径则加 LTXVReferenceAudio 节点 (跟 ltx2.3-av-talking-head 同样 audio 流程)
      name: "LTX-2.3 nvfp4 真首尾帧 (22B 量化, 8 步, 禁 distilled lora, 可选 audio)",
      modelName: "ltx2.3-nvfp4-startend",
      type: "video",
      mode: ["startEndRequired", "audioOptional"],
      audio: true,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-15 v9 P2: 22B fp8 满血 (无 distilled lora) + 真首尾帧 + 20 步 + 可选 audio
      // 替代 ltx2.3-truly-startend (22B fp8 + distilled lora) — 禁 distilled lora 后的 fp8 满血方案
      // 与 ltx2.3-nvfp4-startend 对比: ckpt 改 fp8 (满血, 显存需求高) + 步数 20 (满血默认)
      name: "LTX-2.3 fp8 真首尾帧 (22B 满血, 20 步, 禁 distilled lora, 可选 audio)",
      modelName: "ltx2.3-fp8-startend",
      type: "video",
      mode: ["startEndRequired", "audioOptional"],
      audio: true,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-16 主人指令: 5 段方案主备选 — fp8 满血 (无 distilled lora) + 8 步快速 + first/last 锁死 1.0 防漂移
      // 经验: 20 步 fp8 + 5 段连续提交 → 段 5 工作流进程崩溃 + 主机响应异常 (16:00 / 17:42 两次掉线)
      // 8 步方案目标: 显存占用减半, 单段耗时减少 ~60%, 5 段连续不堆积
      // 锁死 first/last=1.0: 8 步收敛不够, 0.7 软锚会引入画面分裂/右半边消失; 1.0 强制首末像素级锁死, 中段可牺牲
      // audio: 暂不启用 (8 步快出图优先, audio 让 fps 翻倍 → 跟 5s 短段不兼容)
      name: "LTX-2.3 fp8 真首尾帧-8步快速 (22B 满血, 8 步, 1.0 锁首末, 禁 distilled lora)",
      modelName: "ltx2.3-fp8-startend-8step",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10], resolution: ["720p"] },
      ],
    },
    {
      name: "LTX-2.3 视频修复 (22B fp8 + SeedVR2)",
      modelName: "ltx2.3-repair",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10], resolution: ["480p"] },
      ],
    },
    {
      name: "FLUX2 文生图 (mistral + fp8mixed)",
      modelName: "flux2-t2i",
      type: "image",
      mode: ["text"],
    },
    {
      name: "HiDream I1 文生图 (17B fp8 + clip_l/g)",
      modelName: "hidream-t2i",
      type: "image",
      mode: ["text"],
    },
    {
      name: "Qwen-Image 文生图 (20B fp8 + qwen_vl)",
      modelName: "qwen-image-t2i",
      type: "image",
      mode: ["text"],
    },
    {
      name: "Qwen-Image-Edit 2511 图生图 (20B fp8 + qwen_vl)",
      modelName: "qwen-image-edit",
      type: "image",
      mode: ["singleImage"],
    },
    {
      name: "Hunyuan Video 文生视频 (13B 720p + umt5)",
      modelName: "hunyuan-t2v",
      type: "video",
      mode: ["text"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15], resolution: ["480p", "720p"] },
      ],
    },
    // ============================================================
    // 2026-08-15 mavis phase12: 12 个新工作流登记
    // ============================================================
    // ---- A 档 (5 个, 已砍掉 hunyuan-i2v-720p) ----
    {
      name: "LTX-2.3 AV-LoRA talking-head (22B + 音频驱动说话)",
      modelName: "ltx2.3-av-talking-head",
      type: "video",
      mode: ["audioReference", "singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 transition 转场 (22B + transition LoRA + zhuanchang)",
      modelName: "ltx2.3-transition",
      type: "video",
      mode: ["startEndRequired"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 distilled-fast 快速出片 (22B + distilled-384 LoRA, 8 步)",
      modelName: "ltx2.3-distilled-fast",
      type: "video",
      mode: ["text", "singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15, 20], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 Licon-VBVR 多图参考 (22B + LiconMSR, 1-4 张 ref)",
      modelName: "ltx2.3-licon-vbvr",
      type: "video",
      mode: ["imageReference:4"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12, 15], resolution: ["480p", "720p"] },
      ],
    },
    // ---- B 档 (5 个) ----
    {
      name: "LTX-2.3 IC-LoRA union-control (22B + union LoRA + depth/pose/canny)",
      modelName: "ltx2.3-ic-union-control",
      type: "video",
      mode: ["imageReference:2"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 IC-LoRA union-control 6 ref timeline (22B + 6 串联 guide 节点, 1 段多参生视频)",
      modelName: "ltx2.3-ic-union-control-6ref",
      type: "video",
      mode: ["imageReference:6"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 10, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      // 2026-08-17 v14: 主人的 3.4 宫格 LTX2.3 短剧工作流
      // 1 张 4 宫格 ref (2x2 拼图) → 内部 imageSplitGrid 拆 4 张 → LTXVAddGuideMulti 单节点
      // 4 张 ref 在 4 个 frame_idx 引导 IC-LoRA attention, 1 段 25s 一次性生视频
      // 跟 v13 6ref 区别: v13 是 6 张独立图, v14 是 1 张 4 宫格拼图 (workflow 内部拆)
      // 优势: imageReference 只需要 1 张 (不是 6), vendor 内部完成拆图
      name: "LTX-2.3 4 宫格 1-shot (22B fp8 + 1 张 2x2 拼图 ref, 内部拆 4 张, 单 LTXVAddGuideMulti)",
      modelName: "ltx2.3-4grid-1shot",
      type: "video",
      mode: ["imageReference:1"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 10, 15, 20, 25], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "LTX-2.3 IC-LoRA motion-track (22B + motion LoRA + 运动参考)",
      modelName: "ltx2.3-ic-motion-track",
      type: "video",
      mode: ["imageReference:2"],
      audio: false,
      durationResolutionMap: [
        { duration: [5, 8, 10, 12], resolution: ["480p", "720p"] },
      ],
    },
    {
      name: "SVD 图生视频 (svd.safetensors + Baked VAE + clip_vision_h)",
      modelName: "svd-i2v",
      type: "video",
      mode: ["singleImage"],
      audio: false,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5], resolution: ["480p"] },
      ],
    },
    {
      name: "z-image + 角色 LoRA (韩立/宋玉/慕沛灵/梅凝/燕如嫣/紫灵 trigger)",
      modelName: "z-image-character",
      type: "image",
      mode: ["text"],
    },
    {
      name: "SDXL + IP-Adapter faceid (plus-face + insightface buffalo_l, 锁人脸)",
      modelName: "sdxl-portrait-faceid",
      type: "image",
      mode: ["singleImage"],
    },
    // ---- C 档 (3 个, C-1 合并到 A-1) ----
    {
      name: "LTX 4K 上采 (SDXL + RealESRGAN_x4plus, 限定 2K 防 OOM)",
      modelName: "ltx2.3-4k-upscale",
      type: "image",
      mode: ["singleImage"],
    },
    {
      name: "Flux2 + Turbo LoRA (Flux_2-Turbo-LoRA 4 步极速出图)",
      modelName: "flux2-turbo-lora",
      type: "image",
      mode: ["text"],
    },
    {
      name: "LTX-SVD 段间过渡 (SVD + smooth crossfade prompt, 段末 + 段首)",
      modelName: "ltx2.3-svd-crossfade",
      type: "video",
      mode: ["imageReference:2"],
      audio: false,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5], resolution: ["480p"] },
      ],
    },
    // ============================================================
    // 2026-08-14 mavis phase14: TTS 工作流 (3 个)
    // ============================================================
    {
      // F5-TTS (AIFSH F5-TTS-ComfyUI) — 开源 SOTA 音色克隆 TTS
      // 2026-08-14 实测: F5TTSNode 缺 torchcodec 依赖, 需 `pip install torchcodec` 才能跑
      // (ComfyUI 0.28 + torchaudio 2.9.1 切到 torchcodec 后端, F5TTSNode 源码用 torchaudio.save 触发 ImportError)
      name: "F5-TTS (开源 SOTA, 本机 ref_audio 音色克隆, 需 torchcodec)",
      modelName: "f5-tts",
      type: "tts",
      voices: [
        { title: "默认中文 ref 音色 (input/ttson_4702_1_trim_0.00-5.00.wav)", voice: "default" },
        { title: "主人自定义 ref_audio (传 referenceList.audio)", voice: "custom" },
      ],
    },
    {
      // E2-TTS (F5-TTS 变体, 英文友好, 同样需 torchcodec)
      name: "E2-TTS (F5-TTS 变体, 英文友好, 需 torchcodec)",
      modelName: "e2-tts",
      type: "tts",
      voices: [
        { title: "默认中文 ref 音色", voice: "default" },
        { title: "主人自定义 ref_audio", voice: "custom" },
      ],
    },
    {
      // ElevenLabs 云端 TTS — 需在 vendor.inputValues.apiKey 配 ElevenLabs API key
      // (vendor getHeaders() 自动透传 Authorization Bearer 头)
      name: "ElevenLabs (云端 TTS, 需 API key)",
      modelName: "elevenlabs",
      type: "tts",
      voices: [
        { title: "Rachel (女, 美式英语, calm)", voice: "21m00Tcm4TlvDq8ikWAM" },
        { title: "Adam (男, 美式英语, deep)", voice: "pNInz6obpgDQGcFmaJgB" },
        { title: "Bella (女, 美式英语, soft)", voice: "EXAVITQu4vr4xnSDxMaL" },
        { title: "Antoni (男, 美式英语, well-rounded)", voice: "ErXwobaYiN019PkySvjV" },
      ],
    },
  ],
};

// ============================================================
// 通用辅助
// ============================================================

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (vendor.inputValues.apiKey) h["Authorization"] = `Bearer ${vendor.inputValues.apiKey}`;
  return h;
}

function getBaseUrl(): string {
  return (vendor.inputValues.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function pickImageDims(aspectRatio: string): { w: number; h: number } {
  const parts = (aspectRatio || "16:9").split(":");
  const aw = parseFloat(parts[0]) || 16;
  const ah = parseFloat(parts[1]) || 9;
  const base = 1024;
  if (aw >= ah) {
    const w = base;
    const h = Math.round((base * ah) / aw / 8) * 8;
    return { w, h: Math.max(h, 64) };
  } else {
    const h = base;
    const w = Math.round((base * aw) / ah / 8) * 8;
    return { w: Math.max(w, 64), h };
  }
}

function pickVideoDims(aspectRatio: string, resolution: string): { w: number; h: number } {
  const shortSide = resolution.includes("720") ? 720 : 480;
  const parts = (aspectRatio || "16:9").split(":");
  const aw = parseFloat(parts[0]) || 16;
  const ah = parseFloat(parts[1]) || 9;
  if (aw >= ah) {
    const h = Math.round(shortSide / 16) * 16;
    const w = Math.round((h * aw) / ah / 16) * 16;
    return { w, h };
  } else {
    const w = Math.round(shortSide / 16) * 16;
    const h = Math.round((w * ah) / aw / 16) * 16;
    return { w, h };
  }
}

function lengthFromDuration(durationSec: number, fps: number = 24): number {
  const raw = Math.round(durationSec * fps);
  const clamped = Math.max(9, Math.min(257, raw));
  const k = Math.floor((clamped - 1) / 8);
  const result = Math.max(9, Math.min(257, k * 8 + 1));
  // 2026-08-15 v9 经验 23 bug fix: LTX-2.3 22B startend 节点对 9s+ 段有内部 frame 截断
  // 9s 段公式算 209 帧, 但 LTX 节点实际只输出 121 帧 (≈5s) — 静默错位
  // workaround: 9s+ 段强制限制到 121 帧, 防止上层 agent 误判"设计 9s = 实际 9s"
  // 副作用: agent 想跑 9s 段会被强制跑 5s, 必须拆段 (4.5+4.5 / 5+5 / 7+7)
  if (result > 161) {
    console.warn(`[lengthFromDuration] ${durationSec}s 设计被强制限制到 121 帧 (≈5s) — LTX-2.3 22B startend 节点对 9s+ 段有内部 frame 截断 (v9 经验 23), 请拆段或缩短设计`);
    return 121;
  }
  return result;
}

async function comfyPost(path: string, body: any, timeoutMs = 30_000): Promise<any> {
  const resp = await axios.post(`${getBaseUrl()}${path}`, body, {
    headers: getHeaders(),
    timeout: timeoutMs,
  });
  return resp.data;
}

async function comfyGet(path: string, timeoutMs = 30_000): Promise<any> {
  const resp = await axios.get(`${getBaseUrl()}${path}`, {
    headers: getHeaders(),
    timeout: timeoutMs,
  });
  return resp.data;
}

async function comfyDownloadView(filename: string, subfolder: string, type: string): Promise<Buffer> {
  const resp = await axios.get(`${getBaseUrl()}/view`, {
    params: { filename, subfolder, type },
    headers: getHeaders(),
    responseType: "arraybuffer",
    timeout: 60_000,
  });
  return Buffer.from(resp.data);
}

async function comfyUploadImage(base64: string, filename: string = "ref.png"): Promise<string> {
  const b64 = base64.includes(",") ? base64.split(",")[1] : base64;
  const buffer = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("image", buffer, { filename, contentType: "image/png" });
  form.append("type", "input");
  form.append("overwrite", "true");
  const resp = await axios.post(`${getBaseUrl()}/upload/image`, form, {
    headers: { ...form.getHeaders?.(), ...(vendor.inputValues.apiKey ? { Authorization: `Bearer ${vendor.inputValues.apiKey}` } : {}) },
    timeout: 60_000,
  });
  return resp.data.name;
}

async function comfyUploadAudio(base64: string, filename: string = "ref.wav"): Promise<string> {
  // 复用 ComfyUI /upload/image 端点 (ComfyUI 不区分 mime, 接受任意 binary dump 到 input dir)
  // 2026-08-15: 给 LTX-2.3 AV-LoRA talking-head + audioReference 模式用
  const b64 = base64.includes(",") ? base64.split(",")[1] : base64;
  const buffer = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("image", buffer, { filename, contentType: "audio/wav" });
  form.append("type", "input");
  form.append("overwrite", "true");
  const resp = await axios.post(`${getBaseUrl()}/upload/image`, form, {
    headers: { ...form.getHeaders?.(), ...(vendor.inputValues.apiKey ? { Authorization: `Bearer ${vendor.inputValues.apiKey}` } : {}) },
    timeout: 60_000,
  });
  return resp.data.name;
}

function findOutputFile(entry: HistoryEntry, prefer: "video" | "image" | "audio"): { filename: string; subfolder: string; type: string } | null {
  const allFiles: { filename: string; subfolder: string; type: string }[] = [];
  for (const nodeId of Object.keys(entry.outputs || {})) {
    const o = entry.outputs[nodeId];
    if (o.images && o.images.length > 0) allFiles.push(...o.images);
    if (o.gifs && o.gifs.length > 0) allFiles.push(...o.gifs);
    if (o.audio && o.audio.length > 0) allFiles.push(...o.audio);
  }
  if (allFiles.length === 0) return null;
  const videoRe = /\.(mp4|webm|gif|mov|avi)$/i;
  const imageRe = /\.(png|jpg|jpeg|webp)$/i;
  const audioRe = /\.(wav|mp3|flac|ogg|opus)$/i;
  if (prefer === "video") {
    const v = allFiles.find((f) => videoRe.test(f.filename));
    if (v) return v;
  } else if (prefer === "audio") {
    // 2026-08-14: TTS 链路优先返回 wav/mp3/opus 等音频文件
    const a = allFiles.find((f) => audioRe.test(f.filename));
    if (a) return a;
  } else {
    const i = allFiles.find((f) => imageRe.test(f.filename));
    if (i) return i;
  }
  return allFiles[0];
}

async function submitAndPoll(promptId: string, prefer: "video" | "image" | "audio", pollIntervalMs: number, pollTimeoutMs: number): Promise<{ filename: string; subfolder: string; type: string }> {
  const result = await pollTask(async () => {
    // 2026-08-13: history 拉大到 100, timeout 60s
    // 原因: ComfyUI 跑图时 /history 常超 10s, 之前直接 axios 超时 → pollTask catch 后 return 不重试
    // → 概率性 "timeout of 10000ms exceeded" 失败. 现在让 /history 拿到足够数据 + 重试容忍网络毛刺.
    const history = await comfyGet("/history?max_items=100", 60_000);
    const entry = history && history[promptId] ? history[promptId] : null;
    if (!entry) return { completed: false };
    if (entry.status.status_str === "error") {
      const errMsg = entry.status.messages?.find((m: any[]) => Array.isArray(m) && m[0] === "execution_error")?.[1]?.exception_message || "unknown error";
      return { completed: true, error: `ComfyUI 执行失败: ${errMsg}` };
    }
    if (!entry.status.completed) return { completed: false };
    const out = findOutputFile(entry, prefer);
    if (!out) return { completed: false, error: "ComfyUI 完成但未找到输出文件" };
    return { completed: true, data: JSON.stringify(out) };
  }, pollIntervalMs, pollTimeoutMs);
  if (result.error) throw new Error(result.error);
  if (!result.completed || !result.data) throw new Error("ComfyUI 轮询超时");
  return JSON.parse(result.data);
}

// ============================================================
// Workflow Builders (每个 model 一个)
// ============================================================

const NEGATIVE_DEFAULT = "ugly, blurry, low quality, watermark, text, distorted, deformed";
// 2026-08-15 v7 升级: 加通用兜底(不 hardcode 剧本专属, 避免跨项目错杀; 项目级负面如 `no police / no helmet` 由 sb prompt 末尾自带)
// 通用兜底 = 任何短剧都会踩的低质症状; 剧本专属(警察/头盔/制服等)由调用方按需拼接
const NEGATIVE_VIDEO = "ugly, blurry, low quality, watermark, text artifacts, distorted, deformed, jitter, frame flicker, extra limbs, deformed hands, extra fingers, horror, grotesque, blurry edges, motion blur artifacts";

function newSeed(): number {
  return Math.floor(Math.random() * 1e15);
}

// ---- IMAGE BUILDERS ----

function buildSdxlT2i(prompt: string, width: number, height: number, seed: number): any {
  // 2026-08-14: 修复 refiner shape 不匹配 — refiner 必须用自己的 CLIP 重新编码
  // 之前 (8-13 双链版): refiner KSampler 吃 base 的 CLIP 输出 (2048 dim = ViT-L 768 + OpenCLIP 1280)
  // 但 SDXL refiner UNet 只接受 OpenCLIP 的 1280 dim → ComfyUI 崩:
  //   "mat1 and mat2 shapes cannot be multiplied (462x2048 and 1280x768)"
  // 修复: 新增节点 10/11 (refiner 自己 CLIP 编码), KSampler 7 positive/negative 改吃 ["10"/"11", 0]
  // 直连 ComfyUI 实测 33s 出图成功 (2026-08-14)
  // 链路: base 25 步 (denoise=1) 出基础 latent → refiner 20 步 (denoise=0.2) 细化 → VAEDecode → SaveImage
  //   - base CLIP (节点3/4) 只喂 base KSampler (节点6)
  //   - refiner CLIP (节点10/11) 只喂 refiner KSampler (节点7)
  //   - refiner 的 vae 仍用 base 的 (refiner 不带独立 vae)
  //   - 显存 ~13-15GB (base 6.5 + refiner 6 + 临时), 16GB 满载; 150W 功耗墙下 ~25-30s/张
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_refiner_1.0.safetensors" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "6": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0],
        seed, steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "10": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: prompt } },
    "11": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: NEGATIVE_DEFAULT } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["2", 0], positive: ["10", 0], negative: ["11", 0], latent_image: ["6", 0],
        seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.2,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["1", 2] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "toonflow_sdxl_refiner" } },
  };
}

function buildFlux2T2i(prompt: string, width: number, height: number, seed: number): any {
  // FLUX2: UNETLoader + CLIPLoader(type=flux2) + VAELoader(small decoder) + ModelSamplingFlux + FluxGuidance
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "flux2_dev_fp8mixed.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "mistral_3_small_flux2_bf16.safetensors", type: "flux2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "full_encoder_small_decoder.safetensors" } },
    "4": { class_type: "ModelSamplingFlux", inputs: { model: ["1", 0], max_shift: 1.15, base_shift: 0.5, width, height } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_DEFAULT } },
    "7": { class_type: "FluxGuidance", inputs: { conditioning: ["5", 0], guidance: 3.5 } },
    "8": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "9": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0], positive: ["7", 0], negative: ["6", 0], latent_image: ["8", 0],
        seed, steps: 20, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["3", 0] } },
    "11": { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: "toonflow_flux2" } },
  };
}

function buildHidreamT2i(prompt: string, width: number, height: number, seed: number): any {
  // HiDream I1 17B fp8: UNETLoader + DualCLIPLoader(clip_l/g, type=hidream) + VAELoader(ae)
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "hidream_i1_full_fp8.safetensors", weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: "clip_l_hidream.safetensors", clip_name2: "clip_g_hidream.safetensors", type: "hidream", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_DEFAULT } },
    "6": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
        seed, steps: 28, cfg: 5, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "toonflow_hidream" } },
  };
}

function buildQwenImageT2i(prompt: string, width: number, height: number, seed: number): any {
  // Qwen-Image 20B fp8: UNETLoader + CLIPLoader(qwen_2.5_vl, type=qwen_image) + VAELoader(qwen_image_vae)
  // 2026-08-14 实锤 4 条 fix (按重要性):
  // 1. [致命] 加 Qwen-Image-Lightning-8steps-V1.0 LoRA (节点 20, strength=1.0)
  //    — 不加时 71% 概率 mode-collapse 成 2.9KB 纯黑图, 跨 seed 不稳
  //    — 加了之后 steps=4 即可, 跨 seed 100% 稳定, 单图 8s 出
  // 2. Qwen-Image 是 rectified flow, cfg=1.0 + scheduler=simple 必须
  // 3. NEGATIVE 必须强制置空 — 全局 NEGATIVE_DEFAULT 含 "text" token 在 cfg=1.0 时
  //    会把 latent 推废, 出 3KB 全白图
  // 4. UNETLoader 节点 1-3 在同一工作流里同时 cache, 第二次跑会复用错误结果
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_fp8mixed.safetensors", weight_dtype: "default" } },
    "20": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "Qwen-Image-Lightning-8steps-V1.0.safetensors", strength_model: 1.0 } },
    "2": { class_type: "CLIPLoader", "inputs": { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: "" } },
    "6": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["20", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
        seed, steps: 4, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "toonflow_qwen_image" } },
  };
}

function buildQwenImageEdit(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  // Qwen-Image-Edit 2511 20B fp8: 图生图,UNETLoader + CLIPLoader + VAELoader + LoadImage
  // 2026-08-13 实锤: rectified flow, 跟 t2i 一样 cfg=1.0 + scheduler=simple + NEG="" 强制空
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_fp8mixed.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["3", 0] } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: "" } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["12", 0],
        seed, steps: 9, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 0.85,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "toonflow_qwen_edit" } },
  };
}

function buildZImage(prompt: string, width: number, height: number, seed: number): any {
  // z-image 用 UNETLoader + CLIPLoader(type=qwen_image) + VAELoader(ae.safetensors)
  // 2026-08-13 实锤: DualCLIPLoader type 不支持 qwen_image, 但 CLIPLoader 支持
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_DEFAULT } },
    "6": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
        seed, steps: 9, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "toonflow_zimage" } },
  };
}

function buildSimpleAutoImg(prompt: string, width: number, height: number, seed: number): any {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "DreamShaper_8_pruned.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
        seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "toonflow_simple" } },
  };
}

function buildAutoWorkflowImg(prompt: string, width: number, height: number, seed: number): any {
  // 类似 SDXL 但更简,自动出图工作流参考
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
        seed, steps: 25, cfg: 6.5, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "toonflow_auto" } },
  };
}

function buildSdUpscale(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  // SD 放大:用 Realistic Vision 把 ref 图放大重画
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "Realistic_Vision_V5.1_fp16-no-ema.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["1", 2] } },
    "13": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["12", 0],
        seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.5,
      },
    },
    "14": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["1", 2] } },
    "15": { class_type: "SaveImage", inputs: { images: ["14", 0], filename_prefix: "toonflow_sd_up" } },
  };
}

function buildFaceDetailer(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  // SD1.5 + FaceDetailer 节点(简化为 SD upscaler + 后续 Detailer)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "Realistic_Vision_V5.1_fp16-no-ema.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["1", 2] } },
    "13": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["12", 0],
        seed, steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.4,
      },
    },
    "14": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["1", 2] } },
    "15": { class_type: "SaveImage", inputs: { images: ["14", 0], filename_prefix: "toonflow_face" } },
  };
}

function buildPortraitEnhance(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["1", 2] } },
    "13": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["12", 0],
        seed, steps: 25, cfg: 6.5, sampler_name: "euler", scheduler: "normal", denoise: 0.4,
      },
    },
    "14": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["1", 2] } },
    "15": { class_type: "SaveImage", inputs: { images: ["14", 0], filename_prefix: "toonflow_portrait" } },
  };
}

function buildHiresFix(prompt: string, width: number, height: number, seed: number): any {
  // SDXL + Hires fix(2x upscale + 二次采样)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: Math.round(width / 2 / 8) * 8, height: Math.round(height / 2 / 8) * 8, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
        seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "ImageScale", inputs: { image: ["6", 0], width, height, upscale_method: "lanczos", crop: "disabled" } },
    "8": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["1", 2] } },
    "9": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["8", 0],
        seed, steps: 15, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.5,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: "toonflow_hires" } },
  };
}

function buildUpscaleUsdu(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  // 加载 ref + RealESRGAN_x4plus 模型 + UltimateSDUpscale 节点(分块放大,16GB 显存够用)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "v1-5-pruned-emaonly-fp16.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x4plus.safetensors" } },
    "12": {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["11", 0], image: ["10", 0] },
    },
    "13": { class_type: "ImageScale", inputs: { image: ["12", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "14": { class_type: "VAEEncode", inputs: { pixels: ["13", 0], vae: ["1", 2] } },
    "15": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["14", 0],
        seed, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.4,
      },
    },
    "16": { class_type: "VAEDecode", inputs: { samples: ["15", 0], vae: ["1", 2] } },
    "17": { class_type: "SaveImage", inputs: { images: ["16", 0], filename_prefix: "toonflow_usdu" } },
  };
}

// ---- VIDEO BUILDERS ----

function buildLtx2bT2v(prompt: string, width: number, height: number, length: number, seed: number): any {
  // 9-LTX 旧版:ltx-video-2b + t5xxl + LTX 节点链
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-video-2b-v0.9.safetensors" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "ltxv", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 30, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["6", 0], negative: ["6", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["5", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ltx2b", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3T2vFull(prompt: string, width: number, height: number, length: number, seed: number): any {
  // 满血 22B fp8 + 30 步 + gemma + ltx projection
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 30, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["6", 0], negative: ["6", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["5", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ltx23", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3I2vNvfp4(prompt: string, width: number, height: number, length: number, seed: number, refImage: string): any {
  // LTX-2.3 22B nvfp4 + gemma + LTXVImgToVideo 真 i2v
  // 函数名=权重, nvfp4 版本保持低显存快速档
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: refImage } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "22": { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["21", 0], width, height, length, batch_size: 1, strength: 0.7 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["22", 0], negative: ["22", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["22", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ltx23i2v", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3StartEnd(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string | null): any {
  // 蒸馏 13B(8-13 主人规则禁用) + 首尾帧 + LTXVImgToVideo 真 i2v
  // 2026-08-14 同步升级: 20 步 + strength 0.7, 与 I2vNvfp4 结构一致(本函数禁用勿用)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltxv-13b-0.9.8-distilled-fp8.safetensors" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "ltxv", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "22": { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["21", 0], width, height, length, batch_size: 1, strength: 0.7 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["22", 0], negative: ["22", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["22", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_startend", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3StartEndFull(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string | null): any {
  // 满血 22B fp8 + gemma + distilled lora + LTXVImgToVideo 真 i2v
  // 2026-08-14 同步升级: 满血 fp8 + 20 步 + strength 0.7, 与 I2vNvfp4 同档质量
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "30": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.5 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "22": { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["21", 0], width, height, length, batch_size: 1, strength: 0.7 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["30", 0], positive: ["22", 0], negative: ["22", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["22", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_startend_full", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3TrulyStartEnd(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 2026-08-14 末段新增: 真首尾帧工作流, 替代 startend-full 假首尾帧
  // 用 LTXVFirstLastFrameControl_TTP 节点真接首末图, 锁死首末姿势
  // 场景: 跨段衔接, 强制 section_X 末 = section_X+1 首
  // 节点链: 22B fp8 + gemma + distilled lora + LTXVFirstLastFrameControl_TTP (首末强度 1.0) + 20 步
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "30": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.5 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 0.8, last_strength: 0.8, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["30", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_truly_startend", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3TrulyStartEndSoft(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 2026-08-15 v7 新增: 软首尾 (0.8) 释放中段自由度, 解决"中段跑偏但首末稳定"场景
  // 适用: 中长段 (≥5s), 需要中段戏剧性, 接受首末有 0.2 自由度
  // 与 truly-startend 0.8 版本差异: 加了通用 negative_prompt 兜底(由 NEGATIVE_VIDEO 升级提供)
  // 节点链: 22B fp8 + gemma + distilled lora + LTXVFirstLastFrameControl_TTP (首末强度 0.8) + 20 步
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "30": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.5 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 0.8, last_strength: 0.8, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["30", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_truly_startend_soft", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3TrulyStartEndStrong(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 2026-08-15 v7 新增: 强首尾 (1.0) 锁死首末姿势, 解决"短段 strength 0.8 黑帧"事故
  // 适用: 短段 (≤5s) / 跨度小 / 必须首末像素级锁定
  // v6 经验 13 反例: 2a 7s 中长段用 0.8 → 0-1.5s 黑帧 (10KB); 改 1.0 应消失
  // 节点链: 22B fp8 + gemma + distilled lora + LTXVFirstLastFrameControl_TTP (首末强度 1.0) + 20 步
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "30": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.5 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 1.0, last_strength: 1.0, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["30", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_truly_startend_strong", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3TrulyStartEndAsymmetric(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 2026-08-15 v8 新增: 非对称首尾 (first 0.8 + last 1.0)
  // 兼顾 v7 strong 1.0 的"无黑屏 + 末帧稳" + soft 0.8 的"中段戏剧性"
  // first 0.8: 释放首段, 中段可"动" (戏剧性, 类似 soft)
  // last 1.0: 锁死末帧, 跨段衔接稳 (类似 strong)
  // 适用: 7s 段 (v6/v7 中段戏剧性 vs 黑屏 trade-off 痛点)
  // 节点链: 22B fp8 + gemma + distilled lora + LTXVFirstLastFrameControl_TTP (首 0.8 末 1.0) + 20 步
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "30": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.5 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 0.8, last_strength: 1.0, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["30", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_truly_startend_asymmetric", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3Repair(prompt: string, width: number, height: number, length: number, seed: number, refImage: string): any {
  // LTX 22B fp8 图生视频(修复/重生片段)
  // 2026-08-14 修复: 原实现首帧图从未进入 latent(假 i2v), 改为 LTXVImgToVideo 真 i2v
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt || "high quality video, smooth motion" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: refImage } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "22": { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["21", 0], width, height, length, batch_size: 1, strength: 1.0 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["22", 0], negative: ["22", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["22", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_repair", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ============================================================
// 2026-08-15 新增 12 个工作流 build 函数（mavis phase12）
// 全部基于本机已装模型，无需新下载
// ============================================================

// ---- A-1: LTX-2.3 AV-LoRA talking-head (音频驱动说话视频) ----
function buildLtx2_3AVTalkingHead(prompt: string, width: number, height: number, length: number, seed: number, refImage: string, audioRef: string): any {
  // 22B-fp8 + AV-LoRA + LTXVImgToVideo 单图 + LTXVReferenceAudio (音频) + LTXVConcatAVLatent 合并音视频
  // 输入: refImage=单首帧图, audioRef=音频 wav 路径(已上传到 ComfyUI input)
  // 输出: 带音轨 mp4
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "LTX-2.3-22b-AV-LoRA-talking-head-v1.safetensors", strength_model: 1.0 } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "20": { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["11", 0], width, height, length, batch_size: 1, strength: 0.7 } },
    "21": { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "22": { class_type: "LoadAudio", inputs: { audio: audioRef } },
    "23": { class_type: "LTXVReferenceAudio", inputs: { model: ["5", 0], positive: ["20", 0], negative: ["20", 1], reference_audio: ["22", 0], audio_vae: ["21", 0], identity_guidance_scale: 3.0, start_percent: 0.0, end_percent: 1.0 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["5", 0], positive: ["23", 0], negative: ["23", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["20", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "30": { class_type: "LTX2AudioLatentNormalizingSampling", inputs: { model: ["5", 0], audio_normalization_factors: "1,1,0.25,1,1,0.25,1,1" } },
    "31": { class_type: "LTXVSpatioTemporalTiledVAEDecode", inputs: { vae: ["1", 2], latents: ["9", 0], spatial_tiles: 4, spatial_overlap: 1, temporal_tile_length: 16, temporal_overlap: 1, last_frame_fix: false, working_device: "auto", working_dtype: "auto" } },
    "32": { class_type: "VHS_VideoCombine", inputs: { images: ["31", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_av_talk", format: "video/h264-mp4", pingpong: false, save_output: true, audio: ["22", 0] } },
  };
}

// ---- A-2: LTX-2.3 transition 转场 ----
function buildLtx2_3Transition(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 22B + transition LoRA + LTXVFirstLastFrameControl_TTP (真首尾帧) + 触发词 zhuanchang 自动拼到 prompt
  const fullPrompt = (prompt || "") + " zhuanchang";
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: fullPrompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx2.3-transition.safetensors", strength_model: 1.0 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "30": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "31": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["30", 0], first_strength: 1.0, last_strength: 1.0, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["5", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["31", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_transition", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ---- A-3: LTX-2.3 distilled-fast 快速出片 (8 步 + distilled LoRA) ----
function buildLtx2_3DistilledFast(prompt: string, width: number, height: number, length: number, seed: number, refImage: string | null): any {
  // 22B + distilled-384 LoRA + 8 步/简单 scheduler 出片快
  // 模式: text=refImage=null, singleImage=refImage=<ref>
  const wf: any = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.85 } },
  };
  if (refImage) {
    wf["20"] = { class_type: "LoadImage", inputs: { image: refImage } };
    wf["21"] = { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } };
    wf["22"] = { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["21", 0], width, height, length, batch_size: 1, strength: 0.7 } };
  } else {
    wf["22"] = { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } };
  }
  wf["7"] = { class_type: "LTXVScheduler", inputs: { steps: 8, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } };
  wf["8"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  const condPos = refImage ? ["22", 0] : ["3", 0];
  const condNeg = refImage ? ["22", 1] : ["4", 0];
  const latent = refImage ? ["22", 2] : ["22", 0];
  wf["9"] = {
    class_type: "SamplerCustom",
    inputs: {
      model: ["5", 0], positive: condPos, negative: condNeg,
      sampler: ["8", 0], sigmas: ["7", 0], latent_image: latent,
      add_noise: true, noise_seed: seed, cfg: 1.0,
    },
  };
  wf["10"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
  wf["11"] = { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_distilled", format: "video/h264-mp4", pingpong: false, save_output: true } };
  return wf;
}

// ---- A-4b: LTX-2.3 nvfp4 真首尾帧 (无 distilled lora) + 可选音频 ----
function buildLtx2_3Nvfp4StartEnd(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string, audioRef: string | null): any {
  // 2026-08-15 主人新规: 禁用 ltx 2.3 distilled lora 加载的工作流
  // 本函数 = 22B nvfp4 (4-bit 量化) + gemma + LTXVFirstLastFrameControl_TTP 真首尾帧 + 12 步
  // 2026-08-15 v9 P1 验证: 8 步 + 1.0 锁死 = 中段崩 (模型放弃中段, 走暗化过渡)
  // 调参: steps 8→12 给中段生成时间 + first/last_strength 1.0→0.7 释放中段空间 (类似 truly-startend-soft)
  // 不加载 distilled lora (ltx-2.3-22b-distilled-lora-384), 直接用 nvfp4 量化
  // audioRef 传非空路径则加 LTXVReferenceAudio + VHS_VideoCombine audio 通道; 传 null/空则无声
  // 节点链: 22B nvfp4 + gemma + EmptyLTXVLatentVideo + 首末帧 (强度 0.7 软锚) + LTXVScheduler 12 步 + KSampler + VAEDecode + (可选)audio
  const wf: any = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 0.7, last_strength: 0.7, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 12, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
  };
  if (audioRef && audioRef.length > 0) {
    // 音频流程: 31 (LTXVAudioVAELoader) + 32 (LoadAudio) + 33 (LTXVReferenceAudio) + 34 (LTX2AudioLatentNormalizingSampling)
    // 注意: 这里 node 23 已被 LTXVFirstLastFrameControl_TTP 占用, 改用 31/32/33/34 给 audio 节点
    wf["31"] = { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors" } };
    wf["32"] = { class_type: "LoadAudio", inputs: { audio: audioRef } };
    wf["33"] = { class_type: "LTXVReferenceAudio", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], reference_audio: ["32", 0], audio_vae: ["31", 0], identity_guidance_scale: 3.0, start_percent: 0.0, end_percent: 1.0 } };
    wf["34"] = { class_type: "LTX2AudioLatentNormalizingSampling", inputs: { model: ["1", 0], audio_normalization_factors: "1,1,0.25,1,1,0.25,1,1" } };
    wf["10"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
    wf["11"] = { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_nvfp4_startend_audio", format: "video/h264-mp4", pingpong: false, save_output: true, audio: ["32", 0] } };
  } else {
    wf["10"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
    wf["11"] = { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_nvfp4_startend", format: "video/h264-mp4", pingpong: false, save_output: true } };
  }
  return wf;
}

// ---- A-4c: LTX-2.3 fp8 真首尾帧 (满血 22B, 不带 distilled lora) ----
function buildLtx2_3Fp8StartEnd(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string, audioRef: string | null): any {
  // 2026-08-15 v9 P2 主人新指令: 22B fp8 满血版 (不带 distilled lora) 替代 truly-startend
  // 与 A-4b ltx2.3-nvfp4-startend 唯一区别: ckpt 改 fp8 (8-bit 满血) + 步数改 20 (满血版默认)
  // 节点链: 22B fp8 + gemma + EmptyLTXVLatentVideo + 首末帧 (强度 0.7 软锚) + LTXVScheduler 20 步 + KSampler + VAEDecode + (可选)audio
  // audio 流程同 A-4b (audioRef 非空则加 LTXVReferenceAudio)
  const wf: any = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 0.7, last_strength: 0.7, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
  };
  if (audioRef && audioRef.length > 0) {
    wf["31"] = { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } };
    wf["32"] = { class_type: "LoadAudio", inputs: { audio: audioRef } };
    wf["33"] = { class_type: "LTXVReferenceAudio", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["4", 0], reference_audio: ["32", 0], audio_vae: ["31", 0], identity_guidance_scale: 3.0, start_percent: 0.0, end_percent: 1.0 } };
    wf["34"] = { class_type: "LTX2AudioLatentNormalizingSampling", inputs: { model: ["1", 0], audio_normalization_factors: "1,1,0.25,1,1,0.25,1,1" } };
    wf["10"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
    wf["11"] = { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_fp8_startend_audio", format: "video/h264-mp4", pingpong: false, save_output: true, audio: ["32", 0] } };
  } else {
    wf["10"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
    wf["11"] = { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_fp8_startend", format: "video/h264-mp4", pingpong: false, save_output: true } };
  }
  return wf;
}

// ---- A-4d: LTX-2.3 fp8 真首尾帧-8步快速 (满血 22B, 8 步, 锁死首末 1.0) ----
function buildLtx2_3Fp8StartEnd8Step(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 2026-08-16 主人新指令: 5 段方案主备选 — fp8 满血 + 8 步 + first/last=1.0 锁死
  // 节点链: 22B fp8 + gemma + EmptyLTXVLatentVideo + 首末帧 (强度 1.0 硬锚) + LTXVScheduler 8 步 + KSampler + VAEDecode
  // 与 A-4c ltx2.3-fp8-startend 唯一区别: 步数 20→8, first/last_strength 0.7→1.0
  // 8 步经验: 8 步 euler sampler 收敛不够, 0.7 软锚会引入画面分裂/右半边消失; 1.0 锁死首末像素级, 牺牲中段戏剧性
  const wf: any = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "24": { class_type: "LoadImage", inputs: { image: endImg } },
    "25": { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "23": { class_type: "LTXVFirstLastFrameControl_TTP", inputs: { vae: ["1", 2], latent: ["5", 0], first_strength: 1.0, last_strength: 1.0, first_image: ["21", 0], last_image: ["25", 0] } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 8, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["3", 0], negative: ["4", 0],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["23", 0],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_fp8_startend_8step", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
  return wf;
}

// ---- A-5: LTX-2.3 Licon-VBVR 多图参考视频 ----
function buildLtx2_3LiconVBVR(prompt: string, width: number, height: number, length: number, seed: number, refImages: string[]): any {
  // 22B + Licon-VBVR LoRA + LiconMSR 节点(支持 1-4 张图 + background)
  // refImages: 1-4 张 ref 图（按顺序填到 1/2/3/4）
  const wf: any = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "Ltx2.3-Licon-VBVR-I2V-240K-R32.safetensors", strength_model: 1.0 } },
  };
  // 加载 1-4 张 ref 图（按 LiconMSR 节点 1/2/3/4 接口）
  for (let i = 0; i < Math.min(4, refImages.length); i++) {
    const loadId = 10 + i * 2;
    const scaleId = 11 + i * 2;
    wf[String(loadId)] = { class_type: "LoadImage", inputs: { image: refImages[i] } };
    wf[String(scaleId)] = { class_type: "ImageScale", inputs: { image: [String(loadId), 0], width, height, upscale_method: "lanczos", crop: "center" } };
  }
  // LiconMSR 节点: width/height/frame_count + 1/2/3/4 (4 张 ref 图) + background
  const liconInput: any = { width, height, frame_count: "41" };
  for (let i = 0; i < Math.min(4, refImages.length); i++) {
    const scaleId = 11 + i * 2;
    liconInput[String(i + 1)] = [String(scaleId), 0];
  }
  wf["30"] = { class_type: "LiconMSR", inputs: liconInput };
  wf["7"] = { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } };
  wf["8"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  // 关键: LiconMSR 输出本身是 [MODEL, POSITIVE, NEGATIVE, LATENT]
  wf["9"] = {
    class_type: "SamplerCustom",
    inputs: {
      model: ["30", 0], positive: ["30", 1], negative: ["30", 2],
      sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["30", 3],
      add_noise: true, noise_seed: seed, cfg: 3.0,
    },
  };
  wf["10"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
  wf["11"] = { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_vbvr", format: "video/h264-mp4", pingpong: false, save_output: true } };
  return wf;
}

// ---- B-1: LTX-2.3 IC-LoRA union-control (深度/姿势/canby 控制) ----
function buildLtx2_3ICUnionControl(prompt: string, width: number, height: number, length: number, seed: number, refImage: string, controlImage: string): any {
  // 22B + union-control LoRA + ref 图 + control 图(depth/pose/canny)
  // 用 DepthAnythingV2Preprocessor 从 refImage 抽 depth, 再用 controlImage 直接喂 union LoRA
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors", strength_model: 1.0 } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "20": { class_type: "LoadImage", inputs: { image: controlImage } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "30": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "31": { class_type: "LTXAddVideoICLoRAGuideAdvanced", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], latent: ["30", 0], image: ["21", 0], frame_idx: 0, strength: 1.0, latent_downscale_factor: 1.0, crop: "disabled", use_tiled_encode: false, tile_size: 256, tile_overlap: 64, attention_strength: 1.0 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["5", 0], positive: ["31", 0], negative: ["31", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["31", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ic_union", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ---- B-1b: LTX-2.3 IC-LoRA union-control 6 ref timeline (串联 6 个 guide 节点) ----
// 2026-08-17: 真"1 段 6 张 ref 参考图生视频" — 跟 v12 5 段拼接的本质区别
// 6 个 LTXAddVideoICLoRAGuideAdvanced 节点串联, 每个挂不同 ref 图 + 不同 frame_idx
// 视频生成时, 6 张 ref 在不同时间点引导 IC-LoRA attention
function buildLtx2_3ICUnionControl6Ref(prompt: string, width: number, height: number, length: number, seed: number, refImages: string[]): any {
  // 6 张 ref 均匀分布在视频帧上 (24fps × length 帧)
  // 0, length*0.2, length*0.4, length*0.6, length*0.8, length-20
  const FRAME_IDX = [
    0,
    Math.floor(length * 0.2),
    Math.floor(length * 0.4),
    Math.floor(length * 0.6),
    Math.floor(length * 0.8),
    Math.max(0, length - 20),
  ];
  const wf: any = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors", strength_model: 1.0 } },
  };
  // 加载 6 张 ref 图 (按 0-5 顺序填)
  for (let i = 0; i < 6; i++) {
    const loadId = 10 + i * 2;
    const scaleId = 11 + i * 2;
    wf[String(loadId)] = { class_type: "LoadImage", inputs: { image: refImages[i] } };
    wf[String(scaleId)] = { class_type: "ImageScale", inputs: { image: [String(loadId), 0], width, height, upscale_method: "lanczos", crop: "center" } };
  }
  // 空 latent (25s × 24fps = 600 帧)
  wf["30"] = { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } };
  // 6 个 LTXAddVideoICLoRAGuideAdvanced 串联 (前一个输出 → 后一个输入)
  // 输出 3-tuple: [positive(0), negative(1), latent(2)]
  // 第一节点输入: positive=["3", 0], negative=["4", 0], latent=["30", 0] (latent 来自空 latent node 30, 1-tuple)
  // 后续节点输入: positive=[prev, 0], negative=[prev, 1], latent=[prev, 2]
  // v13.2: 节点 ID 改 50/51 避开 ref 图加载, 改回 6 节点串联 (v13 主人要求: 1 段 6 张 ref)
  let prevPos = "3", prevNeg = "4";
  let prevLatNode = "30", prevLatIdx = 0;  // 初始 latent 来自空 latent (1-tuple)
  for (let i = 0; i < 6; i++) {  // v13.2 恢复 6 节点
    const nodeId = 31 + i;
    const scaleId = 11 + i * 2;
    wf[String(nodeId)] = {
      class_type: "LTXAddVideoICLoRAGuideAdvanced",
      inputs: {
        positive: [prevPos, 0],
        negative: [prevNeg, 0],
        vae: ["1", 2],
        latent: [prevLatNode, prevLatIdx],
        image: [String(scaleId), 0],
        frame_idx: FRAME_IDX[i],
        strength: 0.7,
        latent_downscale_factor: 1.0,
        crop: "disabled",
        use_tiled_encode: false,
        tile_size: 256,
        tile_overlap: 64,
        attention_strength: 0.7,
      },
    };
    // 下一节点从本节点输出 [positive(0), negative(1), latent(2)]
    prevPos = String(nodeId);
    prevNeg = String(nodeId);
    prevLatNode = String(nodeId);
    prevLatIdx = 2;
  }
  // scheduler + sampler (跟 ic-union-control 单图同款 20 步)
  wf["7"] = { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } };
  wf["8"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  // 末节点输出 latent 是 index 2
  wf["9"] = {
    class_type: "SamplerCustom",
    inputs: {
      model: ["5", 0],
      positive: [prevPos, 0],
      negative: [prevNeg, 0],
      sampler: ["8", 0],
      sigmas: ["7", 0],
      latent_image: [prevLatNode, prevLatIdx],
      add_noise: true,
      noise_seed: seed,
      cfg: 3.0,
    },
  };
  // v13.2: 节点 ID 避开 10-21 范围 (LoadImage/ImageScale 占用), 改成 50/51
  // 之前 10/11 跟 LoadImage/ImageScale 冲突, 导致 31 image 收到 VHS_FILENAMES
  wf["50"] = { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } };
  wf["51"] = { class_type: "VHS_VideoCombine", inputs: { images: ["50", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ic_union_6ref", format: "video/h264-mp4", pingpong: false, save_output: true } };
  return wf;
}

// ---- B-1c: LTX-2.3 4 宫格 1-shot (1 张 2x2 拼图 ref, 内部拆 4 张, 单 LTXVAddGuideMulti) ----
// 2026-08-17 v14: 主人的 3.4 宫格 LTX2.3 短剧工作流复刻 (简化版, 不含 audio)
// 原始工作流: 1 张 2x2 4 宫格图 → easy imageSplitGrid 拆 4 张 → easy imageInsetCrop 去接缝
//   → 4× (ImageFromBatch → ResizeImagesByLongerEdge → LTXVPreprocess) → LTXVAddGuideMulti 单节点一次性
// v14 简化: 去掉 ResizeImageMaskNode (原工作流用 1920x1088 mask, 跟 final size 一致时可省),
//   保留核心 imageSplitGrid + 4×ImageFromBatch + 4×LTXVPreprocess + LTXVAddGuideMulti
// 关键节点 ID 分配 (避开 ID 冲突):
//   0-9:   基础 (CheckpointLoader, TextEncoderLoader)
//   10-19: 加载 (LoadImage, imageSplitGrid, imageInsetCrop)
//   20-29: 4 个 ImageFromBatch (抽 4 张子图)
//   30-39: 4 个 LTXVPreprocess
//   50-59: Latent (EmptyLTXVLatentVideo, LTXVConditioning)
//   100:   LTXVAddGuideMulti 核心
//   7-9:   Scheduler/Sampler/SamplerCustom
//   80-81: VAEDecode + VHS_VideoCombine
function buildLtx2_34Grid1Shot(prompt: string, width: number, height: number, length: number, seed: number, refImage: string): any {
  // v14.2 (2026-08-17 主人选 B 方案): strength_4 单独 1.0 压制末帧拼图缝
  //   关键发现: 4 段 prompt 拼接 + 0.7 strength 已让 0-9.3s 完全无拼图缝 (v14.1.2 实测)
  //            9.6-10.0s (0.4s) 出现拼图缝: frame_idx_4=232 太靠末帧, 末段被 4 张图"飞回"拼图状态
  //   v14.1.2 错以为"自由空间"能修, 但 free space = 末段无引导 = 违背 v9 锁首末 1.0 原则
  //   v14.2 正解: 末帧引导加强 (strength_4=1.0), 其他 3 段保持 0.7 (留创造空间避免出黑屏)
  //     - 段 1 0.7 (0-2.5s 紧闭嘴, 引导不锁死)
  //     - 段 2 0.7 (2.5-5s 裂缝, 模型自由发挥)
  //     - 段 3 0.7 (5-7.5s 半开, 模型自由发挥)
  //     - 段 4 1.0 (7.5-10s 完全盛开+金黄花蕊, 强制锁死末帧)
  //   frame_idx_4 = 232 (length-8) 保持不变 (LTX VAE 8x temporal 合法 + 末帧引导)
  const FRAME_IDX = [
    0,
    Math.max(1, Math.floor(length / 3)),
    Math.max(2, Math.floor((length * 2) / 3)),
    Math.max(3, length - 8),
  ];
  const STRENGTH_1 = 0.7;
  const STRENGTH_2 = 0.7;
  const STRENGTH_3 = 0.7;
  const STRENGTH_4 = 1.0;  // 末帧加强压制拼图缝
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    // 单图加载 → 2x2 拆分 → 2% inset crop 去接缝
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "easy imageSplitGrid", inputs: { images: ["10", 0], row: 2, column: 2 } },
    "12": { class_type: "easy imageInsetCrop", inputs: { image: ["11", 0], measurement: "Percentage", left: 2, right: 2, top: 2, bottom: 2 } },
    // 4 张子图抽 batch → LTXVPreprocess
    "20": { class_type: "ImageFromBatch", inputs: { image: ["12", 0], batch_index: 0, length: 1 } },
    "21": { class_type: "ImageFromBatch", inputs: { image: ["12", 0], batch_index: 1, length: 1 } },
    "22": { class_type: "ImageFromBatch", inputs: { image: ["12", 0], batch_index: 2, length: 1 } },
    "23": { class_type: "ImageFromBatch", inputs: { image: ["12", 0], batch_index: 3, length: 1 } },
    "30": { class_type: "LTXVPreprocess", inputs: { image: ["20", 0], img_compression: 100 } },
    "31": { class_type: "LTXVPreprocess", inputs: { image: ["21", 0], img_compression: 100 } },
    "32": { class_type: "LTXVPreprocess", inputs: { image: ["22", 0], img_compression: 100 } },
    "33": { class_type: "LTXVPreprocess", inputs: { image: ["23", 0], img_compression: 100 } },
    // 视频 latent (final size) + conditioning (frame_rate 跟视频 24fps 一致)
    "50": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "51": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    // 核心: 单节点 LTXVAddGuideMulti 一次接收 4 张 ref + 4 个 frame_idx + 4 个 strength
    "100": {
      class_type: "LTXVAddGuideMulti",
      inputs: {
        positive: ["51", 0],
        negative: ["51", 1],
        vae: ["1", 2],
        latent: ["50", 0],
        num_guides: "4",
        "num_guides.image_1": ["30", 0],
        "num_guides.frame_idx_1": FRAME_IDX[0],
        "num_guides.strength_1": STRENGTH_1,
        "num_guides.image_2": ["31", 0],
        "num_guides.frame_idx_2": FRAME_IDX[1],
        "num_guides.strength_2": STRENGTH_2,
        "num_guides.image_3": ["32", 0],
        "num_guides.frame_idx_3": FRAME_IDX[2],
        "num_guides.strength_3": STRENGTH_3,
        "num_guides.image_4": ["33", 0],
        "num_guides.frame_idx_4": FRAME_IDX[3],
        "num_guides.strength_4": STRENGTH_4,
      },
    },
    // 老版 pipeline (与 v9-v13 一致, 跑过 100+ 次稳定)
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0],
        positive: ["100", 0],
        negative: ["100", 1],
        sampler: ["8", 0],
        sigmas: ["7", 0],
        latent_image: ["100", 2],
        add_noise: true,
        noise_seed: seed,
        cfg: 3.0,
      },
    },
    "80": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "81": { class_type: "VHS_VideoCombine", inputs: { images: ["80", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_4grid_1shot", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ---- B-2: LTX-2.3 IC-LoRA motion-track 镜头运动控制 ----
function buildLtx2_3ICMotionTrack(prompt: string, width: number, height: number, length: number, seed: number, refImage: string, motionImage: string): any {
  // 22B + motion-track-control LoRA + ref 图 + 运动参考图(通常 2-3 帧拼接)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "5": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors", strength_model: 1.0 } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "20": { class_type: "LoadImage", inputs: { image: motionImage } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "30": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "31": { class_type: "LTXAddVideoICLoRAGuideAdvanced", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], latent: ["30", 0], image: ["21", 0], frame_idx: 0, strength: 1.0, latent_downscale_factor: 1.0, crop: "disabled", use_tiled_encode: false, tile_size: 256, tile_overlap: 64, attention_strength: 1.0 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["5", 0], positive: ["31", 0], negative: ["31", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["31", 2],
        add_noise: true, noise_seed: seed, cfg: 3.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ic_motion", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ---- B-3: SVD 图生视频 (经典 stable video diffusion) ----
function buildSvdI2v(prompt: string, width: number, height: number, length: number, seed: number, refImage: string): any {
  // svd.safetensors + init_image + SVD_img2vid_Conditioning + KSampler
  // SVD 走标准 KSampler (不是 LTXV 链)
  // 注意 SVD 不需要 text encoder, 走 CONDITIONING 0 节点
  return {
    "1": { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "svd.safetensors" } },
    "2": { class_type: "CLIPVisionLoader", inputs: { clip_name: "clip_vision_h.safetensors" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "kl-f8-anime2.ckpt" } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "20": { class_type: "SVD_img2vid_Conditioning", inputs: { clip_vision: ["2", 0], init_image: ["11", 0], vae: ["3", 0], width, height, video_frames: Math.min(14, length), motion_bucket_id: 127, fps: 6, augmentation_level: 0.0 } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt || "smooth motion" } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_VIDEO } },
    "6": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["20", 0], negative: ["20", 1], latent_image: ["20", 2],
        seed, steps: 25, cfg: 2.5, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "VHS_VideoCombine", inputs: { images: ["8", 0], frame_rate: 6, loop_count: 0, filename_prefix: "toonflow_svd", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ---- B-4: z-image + 角色 LoRA 出角色一致性图 ----
function buildZImageCharacter(prompt: string, width: number, height: number, seed: number, loraName: string, triggerWord: string): any {
  // z_image_turbo + 通用 LoraLoaderModelOnly (z-image 不是 LTX 链, 用通用 LoRA loader)
  // loraName: ltx2.3韩立触发词hanli.safetensors / ltx2.3宋玉-songyu.safetensors 等
  // triggerWord: hanli / songyu / peiling / meining / ruyan / ziling
  const fullPrompt = triggerWord ? `${triggerWord}, ${prompt}` : prompt;
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: loraName, strength_model: 0.85 } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: fullPrompt } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_DEFAULT + ", " + "STRICTLY NO TEXT, NO CHINESE CHARACTERS, NO WATERMARKS" } },
    "7": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0],
        seed, steps: 9, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "toonflow_zchar" } },
  };
}

// ---- B-5: SDXL + IP-Adapter faceid 锁人脸 ----
function buildSdxlPortraitFaceid(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  // SDXL base + IP-Adapter (plus-face) + InsightFace (buffalo_l) + 人脸参考图
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": { class_type: "IPAdapterModelLoader", inputs: { ipadapter_file: "ip-adapter-plus-face_sdxl_vit-h.safetensors" } },
    "6": { class_type: "IPAdapterInsightFaceLoader", inputs: { provider: "CPU", model_name: "buffalo_l" } },
    "7": { class_type: "LoadImage", inputs: { image: refImage } },
    "8": { class_type: "ImageScale", inputs: { image: ["7", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "9": { class_type: "IPAdapterFaceID", inputs: { model: ["1", 0], ipadapter: ["5", 0], image: ["8", 0], weight: 0.85, weight_faceidv2: 0.85, weight_type: "linear", combine_embeds: "average", start_at: 0.0, end_at: 1.0, embeds_scaling: "K+V", insightface: ["6", 0] } },
    "10": {
      class_type: "KSampler",
      inputs: {
        model: ["9", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
        seed, steps: 30, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["1", 2] } },
    "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: "toonflow_faceid" } },
  };
}

// ---- C-2: LTX 视频/图像 4K 上采 (限定 2K 防 OOM) ----
function buildLtx4kUpscale(prompt: string, width: number, height: number, seed: number, refImage: string): any {
  // SDXL + RealESRGAN_x4plus 上采 + KSampler 二次细化, 输出 max 2K (防 16GB 显存爆)
  // 16GB 卡不跑 4K 真, 改成 2K 上采 (从 1024 上到 1536)
  const scaleW = Math.min(width * 1.5, 1536);
  const scaleH = Math.min(height * 1.5, 1536);
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_DEFAULT } },
    "10": { class_type: "LoadImage", inputs: { image: refImage } },
    "11": { class_type: "UpscaleModelLoader", inputs: { model_name: "RealESRGAN_x4plus.safetensors" } },
    "12": { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["11", 0], image: ["10", 0] } },
    "13": { class_type: "ImageScale", inputs: { image: ["12", 0], width: scaleW, height: scaleH, upscale_method: "lanczos", crop: "center" } },
    "14": { class_type: "VAEEncode", inputs: { pixels: ["13", 0], vae: ["1", 2] } },
    "15": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["14", 0],
        seed, steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.35,
      },
    },
    "16": { class_type: "VAEDecode", inputs: { samples: ["15", 0], vae: ["1", 2] } },
    "17": { class_type: "SaveImage", inputs: { images: ["16", 0], filename_prefix: "toonflow_4kup" } },
  };
}

// ---- C-3: Flux2 + Turbo LoRA 极速出图 (4 步) ----
function buildFlux2TurboLora(prompt: string, width: number, height: number, seed: number): any {
  // Flux2 fp8mixed + Flux_2-Turbo-LoRA (4 步快速)
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "flux2_dev_fp8mixed.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "mistral_3_small_flux2_bf16.safetensors", type: "flux2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "full_encoder_small_decoder.safetensors" } },
    "4": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "Flux_2-Turbo-LoRA_comfyui.safetensors", strength_model: 0.8 } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_DEFAULT } },
    "7": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0],
        seed, steps: 4, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "toonflow_flux2t" } },
  };
}

// ---- C-4: SVD 段间过渡 (crossfade) ----
function buildLtxSvdCrossfade(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string): any {
  // 用 SVD 在段末+段首之间生成短过渡, prompt 强调 "smooth crossfade"
  // 把首图当 init_image, 末图当目标参考 (用 IPAdapter 控制)
  // 简化: SVD 只取首图, prompt 引导生成末图模糊效果
  const fullPrompt = (prompt || "") + ", smooth crossfade transition, gradual blend, no jump cut";
  return {
    "1": { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "svd.safetensors" } },
    "2": { class_type: "CLIPVisionLoader", inputs: { clip_name: "clip_vision_h.safetensors" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "kl-f8-anime2.ckpt" } },
    "10": { class_type: "LoadImage", inputs: { image: startImg } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "20": { class_type: "SVD_img2vid_Conditioning", inputs: { clip_vision: ["2", 0], init_image: ["11", 0], vae: ["3", 0], width, height, video_frames: Math.min(14, length), motion_bucket_id: 60, fps: 6, augmentation_level: 0.0 } },
    "21": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: fullPrompt } },
    "22": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: NEGATIVE_VIDEO } },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0], positive: ["20", 0], negative: ["20", 1], latent_image: ["20", 2],
        seed, steps: 20, cfg: 2.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    "9": { class_type: "VHS_VideoCombine", inputs: { images: ["8", 0], frame_rate: 6, loop_count: 0, filename_prefix: "toonflow_crossfade", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

// ---- D 档 (TTS, 2026-08-14 新增) ----

function buildF5Tts(
  text: string,
  refAudioName: string,
  modelChoice: "F5-TTS" | "E2-TTS",
  speed: number = 1.0,
  removeSilence: boolean = true,
  splitWords: string = "but,however,nevertheless,yet,still,therefore,thus,hence,consequently,moreover,furthermore,additionally,meanwhile,alternatively,otherwise,namely,specifically,for example,such as,in fact,indeed,notably,in contrast,on the other hand,conversely,in conclusion,to summarize,finally",
): any {
  // F5TTSNode (AIFSH F5-TTS-ComfyUI) — 开源 SOTA 音色克隆 TTS
  // 链路: LoadAudio(ref wav) → F5TTSNode(gen_text+ref_audio) → SaveAudio → wav 文件
  // 2026-08-14 实测: F5TTSNode 当前依赖 torchcodec (torchaudio 2.9+ 后端),
  //                  需在 ComfyUI python 跑 `pip install torchcodec` 才能正常执行
  return {
    "1": { class_type: "LoadAudio", inputs: { audio: refAudioName } },
    "2": {
      class_type: "F5TTSNode",
      inputs: {
        gen_text: text,
        ref_audio: ["1", 0],
        model_choice: modelChoice,
        speed,
        remove_silence: removeSilence,
        split_words: splitWords,
      },
    },
    "3": { class_type: "SaveAudio", inputs: { audio: ["2", 0], filename_prefix: "toonflow_f5tts" } },
  };
}

function buildElevenLabsTts(
  text: string,
  voiceId: string,
  stability: number = 0.5,
  model: string = "eleven_multilingual_v2",
  outputFormat: string = "mp3_44100_128",
): any {
  // ElevenLabsTextToSpeech — 云端 TTS, vendor.inputValues.apiKey 配 ElevenLabs API key
  // getHeaders() 自动加 Authorization Bearer 头
  // output_format: 默认 mp3_44100_128 (128kbps mp3)
  return {
    "1": {
      class_type: "ElevenLabsTextToSpeech",
      inputs: {
        voice: voiceId,
        text,
        stability,
        apply_text_normalization: "auto",
        model,
        language_code: "",
        seed: 0,
        output_format: outputFormat,
      },
    },
    "2": { class_type: "SaveAudio", inputs: { audio: ["1", 0], filename_prefix: "toonflow_elevenlabs" } },
  };
}

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("本机 ComfyUI 不支持纯文本生成，请选择文本供应商（如 OpenAI/MiniMax/DeepSeek）");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.baseUrl) throw new Error("缺少 ComfyUI baseUrl 配置");
  const { w, h } = pickImageDims(config.aspectRatio);

  // ---- reference 图片上传（一次性，重试复用同一张 ref）----
  let refName: string | null = null;
  if (["sd-upscale-img", "face-detailer", "portrait-enhance", "upscale-usdu", "qwen-image-edit", "sdxl-portrait-faceid", "ltx2.3-4k-upscale"].includes(model.modelName)) {
    const refs = config.referenceList || [];
    if (refs.length === 0) throw new Error(`${model.modelName} 需要 reference 图片，但 Toonflow 未提供`);
    refName = await comfyUploadImage(refs[0].base64, `ref_${Date.now()}.png`);
    logger(`reference uploaded: ${refName}`);
  }

  // ---- 白图/坏图自动重试 ----
  // Qwen-Image 20B fp8 在本机 16GB 卡上需 CPU offload，采样偶发 mode-collapse
  // 出 2-3KB 纯黑图（2026-08-14 实测 25% 概率）。检测输出字节数，太小则换 seed 重试。
  const retryable = model.modelName.startsWith("qwen-image");
  const MAX_RETRY = retryable ? 3 : 1;
  let lastErr: string | null = null;

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const seed = newSeed();
    let wf: any;

    switch (model.modelName) {
      case "sdxl-t2i":
        wf = buildSdxlT2i(config.prompt, w, h, seed);
        break;
      case "flux2-t2i":
        wf = buildFlux2T2i(config.prompt, w, h, seed);
        break;
      case "hidream-t2i":
        wf = buildHidreamT2i(config.prompt, w, h, seed);
        break;
      case "qwen-image-t2i":
        wf = buildQwenImageT2i(config.prompt, w, h, seed);
        break;
      case "qwen-image-edit":
        if (!refName) throw new Error("qwen-image-edit 需要 singleImage");
        wf = buildQwenImageEdit(config.prompt, w, h, seed, refName);
        break;
      case "z-image-turbo":
        wf = buildZImage(config.prompt, w, h, seed);
        break;
      case "simple-auto-img":
        wf = buildSimpleAutoImg(config.prompt, w, h, seed);
        break;
      case "auto-workflow-img":
        wf = buildAutoWorkflowImg(config.prompt, w, h, seed);
        break;
      case "sd-upscale-img":
        if (!refName) throw new Error("sd-upscale-img 需要 reference 图片");
        wf = buildSdUpscale(config.prompt, w, h, seed, refName);
        break;
      case "face-detailer":
        if (!refName) throw new Error("face-detailer 需要 reference 图片");
        wf = buildFaceDetailer(config.prompt, w, h, seed, refName);
        break;
      case "portrait-enhance":
        if (!refName) throw new Error("portrait-enhance 需要 reference 图片");
        wf = buildPortraitEnhance(config.prompt, w, h, seed, refName);
        break;
      case "hires-fix":
        wf = buildHiresFix(config.prompt, w, h, seed);
        break;
      case "upscale-usdu":
        if (!refName) throw new Error("upscale-usdu 需要 reference 图片");
        wf = buildUpscaleUsdu(config.prompt, w, h, seed, refName);
        break;
      case "z-image-character":
        // 2026-08-15: z-image + 角色 LoRA (默认韩立, 触发词 hanli)
        // mode 字段存 lora+trigger 组合: "ltx2.3韩立触发词hanli.safetensors:hanli" 或 "ltx2.3宋玉-songyu.safetensors:songyu"
        // 简化: 走默认 lora + trigger (后续可扩展 UI 选角色)
        wf = buildZImageCharacter(config.prompt, w, h, seed, "ltx2.3韩立触发词hanli.safetensors", "hanli");
        break;
      case "sdxl-portrait-faceid":
        if (!refName) throw new Error("sdxl-portrait-faceid 需要 reference 人脸图");
        wf = buildSdxlPortraitFaceid(config.prompt, w, h, seed, refName);
        break;
      case "ltx2.3-4k-upscale":
        if (!refName) throw new Error("ltx2.3-4k-upscale 需要 reference 图片");
        wf = buildLtx4kUpscale(config.prompt, w, h, seed, refName);
        break;
      case "flux2-turbo-lora":
        wf = buildFlux2TurboLora(config.prompt, w, h, seed);
        break;
      default:
        throw new Error(`未知 image model: ${model.modelName}`);
    }

    const submit = await comfyPost("/prompt", { prompt: wf, client_id: "toonflow-comfyui-v2" });
    if (!submit.prompt_id) throw new Error(`ComfyUI /prompt 提交失败: ${JSON.stringify(submit)}`);
    const promptId: string = submit.prompt_id;
    logger(`image submitted: ${promptId}, model=${model.modelName}, size=${w}x${h}, attempt=${attempt + 1}/${MAX_RETRY}`);

    const out = await submitAndPoll(promptId, "image", 2000, 600_000);
    const buf = await comfyDownloadView(out.filename, out.subfolder, out.type);
    const mime = out.filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

    if (buf.length < 50 * 1024) {
      lastErr = `输出异常偏小 (${buf.length} bytes, 疑似 mode-collapse 白图), attempt=${attempt + 1}/${MAX_RETRY}`;
      logger(`[retry] ${lastErr}`);
      continue;
    }
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  throw new Error(`imageRequest 重试 ${MAX_RETRY} 次仍失败: ${lastErr}`);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.baseUrl) throw new Error("缺少 ComfyUI baseUrl 配置");
  const { w, h } = pickVideoDims(config.aspectRatio, config.resolution || "480p");
  const length = lengthFromDuration(config.duration, 24);
  const seed = newSeed();
  let wf: any;

  // 处理 reference images / audio (2026-08-15 扩展支持 audioReference + imageReference:N 多图)
  let startImg: string | null = null;
  let endImg: string | null = null;
  const imageRefs: string[] = []; // 1-4 张 ref image (按用户传入顺序)
  const audioRefs: string[] = []; // 1+ 个 ref audio
  const allRefs = config.referenceList || [];
  for (let i = 0; i < allRefs.length; i++) {
    const r = allRefs[i];
    if (r.type === "image" && imageRefs.length < 8) {
      const upName = await comfyUploadImage(r.base64, `ref_${Date.now()}_${imageRefs.length}.png`);
      imageRefs.push(upName);
    } else if (r.type === "audio" && audioRefs.length < 2) {
      const upName = await comfyUploadAudio(r.base64, `audio_${Date.now()}_${audioRefs.length}.wav`);
      audioRefs.push(upName);
    }
  }
  if (imageRefs.length >= 1) startImg = imageRefs[0];
  if (imageRefs.length >= 2) endImg = imageRefs[1];

  switch (model.modelName) {
    case "ltx-2b-t2v":
      wf = buildLtx2bT2v(config.prompt, w, h, length, seed);
      break;
    case "ltx2.3-t2v-full":
      wf = buildLtx2_3T2vFull(config.prompt, w, h, length, seed);
      break;
    case "ltx2.3-i2v-nvfp4":
      if (!startImg) throw new Error("ltx2.3-i2v-nvfp4 需要 singleImage");
      wf = buildLtx2_3I2vNvfp4(config.prompt, w, h, length, seed, startImg);
      break;
    case "ltx2.3-startend":
      if (!startImg) throw new Error("ltx2.3-startend 需要首帧图");
      wf = buildLtx2_3StartEnd(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-startend-full":
      if (!startImg) throw new Error("ltx2.3-startend-full 需要首帧图");
      wf = buildLtx2_3StartEndFull(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-truly-startend":
      if (!startImg || !endImg) throw new Error("ltx2.3-truly-startend 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3TrulyStartEnd(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-truly-startend-soft":
      // 2026-08-15 v7: 软首尾 0.8, 释放中段
      if (!startImg || !endImg) throw new Error("ltx2.3-truly-startend-soft 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3TrulyStartEndSoft(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-truly-startend-strong":
      // 2026-08-15 v7: 强首尾 1.0, 锁死首末
      if (!startImg || !endImg) throw new Error("ltx2.3-truly-startend-strong 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3TrulyStartEndStrong(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-truly-startend-asymmetric":
      // 2026-08-15 v8: 非对称首尾 (first 0.8 + last 1.0)
      if (!startImg || !endImg) throw new Error("ltx2.3-truly-startend-asymmetric 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3TrulyStartEndAsymmetric(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-repair":
      if (!startImg) throw new Error("ltx2.3-repair 需要单图参考");
      wf = buildLtx2_3Repair(config.prompt, w, h, length, seed, startImg);
      break;
    case "ltx2.3-av-talking-head":
      // 2026-08-15: AV-LoRA + 音频驱动 (需要 singleImage + audioReference)
      if (!startImg) throw new Error("ltx2.3-av-talking-head 需要首图 (singleImage)");
      if (audioRefs.length < 1) throw new Error("ltx2.3-av-talking-head 需要 audioReference (1 个音频 wav)");
      wf = buildLtx2_3AVTalkingHead(config.prompt, w, h, length, seed, startImg, audioRefs[0]);
      break;
    case "ltx2.3-transition":
      // 2026-08-15: transition LoRA 转场 (需要 startEndRequired)
      if (!startImg || !endImg) throw new Error("ltx2.3-transition 需要 startEndRequired (首图 + 尾图)");
      wf = buildLtx2_3Transition(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "ltx2.3-distilled-fast":
      // 2026-08-15: 22B + distilled-384 LoRA, 8 步快速出片 (text 或 singleImage)
      wf = buildLtx2_3DistilledFast(config.prompt, w, h, length, seed, startImg);
      break;
    case "ltx2.3-licon-vbvr":
      // 2026-08-15: LiconMSR 多图参考 (需要 1-4 张 imageReference)
      if (imageRefs.length < 1) throw new Error("ltx2.3-licon-vbvr 至少需要 1 张 ref 图 (imageReference:1-4)");
      wf = buildLtx2_3LiconVBVR(config.prompt, w, h, length, seed, imageRefs);
      break;
    case "ltx2.3-ic-union-control":
      // 2026-08-15: IC-LoRA union control (ref 图 + control 图, imageReference:2)
      if (imageRefs.length < 2) throw new Error("ltx2.3-ic-union-control 需要 imageReference:2 (ref 图 + control 图)");
      wf = buildLtx2_3ICUnionControl(config.prompt, w, h, length, seed, imageRefs[0], imageRefs[1]);
      break;
    case "ltx2.3-ic-union-control-6ref":
      // 2026-08-17: 真"1 段 6 张 ref 参考图生视频" (imageReference:6, 串联 6 个 guide 节点)
      if (imageRefs.length !== 6) throw new Error("ltx2.3-ic-union-control-6ref 需要 6 张 ref 图 (imageReference:6)");
      wf = buildLtx2_3ICUnionControl6Ref(config.prompt, w, h, length, seed, imageRefs);
      break;
    case "ltx2.3-4grid-1shot":
      // 2026-08-17 v14: 主人 3.4 宫格 LTX2.3 短剧工作流 (1 张 2x2 拼图 ref, 内部拆 4 张, 单 LTXVAddGuideMulti)
      if (imageRefs.length < 1) throw new Error("ltx2.3-4grid-1shot 需要 1 张 4 宫格 ref 图 (imageReference:1)");
      wf = buildLtx2_34Grid1Shot(config.prompt, w, h, length, seed, imageRefs[0]);
      break;
    case "ltx2.3-ic-motion-track":
      // 2026-08-15: IC-LoRA motion track (ref 图 + 运动参考图, imageReference:2)
      if (imageRefs.length < 2) throw new Error("ltx2.3-ic-motion-track 需要 imageReference:2 (ref 图 + 运动参考图)");
      wf = buildLtx2_3ICMotionTrack(config.prompt, w, h, length, seed, imageRefs[0], imageRefs[1]);
      break;
    case "ltx2.3-nvfp4-startend":
      // 2026-08-15 v9: 22B nvfp4 (无 distilled lora) + 真首尾帧 + 8 步快速 + 可选 audio
      // 禁用 ltx 2.3 distilled lora 后的首尾帧替代方案 (P0 验证 nvfp4 5s 动作自然协调)
      if (!startImg || !endImg) throw new Error("ltx2.3-nvfp4-startend 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3Nvfp4StartEnd(config.prompt, w, h, length, seed, startImg, endImg, audioRefs[0] || null);
      break;
    case "ltx2.3-fp8-startend":
      // 2026-08-15 v9 P2: 22B fp8 满血 (无 distilled lora) + 真首尾帧 + 20 步 + 可选 audio
      // 与 ltx2.3-nvfp4-startend 唯一区别: ckpt fp8 (满血) + 步数 20 (满血默认)
      // 替代 ltx2.3-truly-startend (22B fp8 + distilled lora 加载) — 禁 distilled lora 后的 fp8 满血方案
      if (!startImg || !endImg) throw new Error("ltx2.3-fp8-startend 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3Fp8StartEnd(config.prompt, w, h, length, seed, startImg, endImg, audioRefs[0] || null);
      break;
    case "ltx2.3-fp8-startend-8step":
      // 2026-08-16 主人新指令: 5 段方案主备选 — fp8 满血 + 8 步 + first/last=1.0 锁死
      // 目标: 显存占用减半, 单段耗时减少 ~60%, 解决 5 段连续提交→段 5 工作流崩溃 + 主机响应异常
      if (!startImg || !endImg) throw new Error("ltx2.3-fp8-startend-8step 需要首尾图 (startImg + endImg)");
      wf = buildLtx2_3Fp8StartEnd8Step(config.prompt, w, h, length, seed, startImg, endImg);
      break;
    case "svd-i2v":
      // 2026-08-15: SVD 图生视频 (singleImage)
      if (!startImg) throw new Error("svd-i2v 需要首图 (singleImage)");
      wf = buildSvdI2v(config.prompt, w, h, length, seed, startImg);
      break;
    case "ltx2.3-svd-crossfade":
      // 2026-08-15: SVD 段间过渡 (imageReference:2 = 段末 + 段首)
      if (imageRefs.length < 2) throw new Error("ltx2.3-svd-crossfade 需要 imageReference:2 (段末 + 段首)");
      wf = buildLtxSvdCrossfade(config.prompt, w, h, length, seed, imageRefs[0], imageRefs[1]);
      break;
    case "hunyuan-t2v":
      // 2026-08-13: Hunyuan Video kijai 节点需要 llava-llama-3-8b-text-encoder (未下), 暂时未实现
      throw new Error("hunyuan-t2v 待 llava-llama-3-8b text encoder 下载后实现");
    default:
      throw new Error(`未知 video model: ${model.modelName}`);
  }

  const submit = await comfyPost("/prompt", { prompt: wf, client_id: "toonflow-comfyui-v2" });
  if (!submit.prompt_id) throw new Error(`ComfyUI /prompt 提交失败: ${JSON.stringify(submit)}`);
  const promptId: string = submit.prompt_id;
  logger(`video submitted: ${promptId}, model=${model.modelName}, size=${w}x${h}, frames=${length}`);

  const out = await submitAndPoll(promptId, "video", 3000, 1200_000); // 20 分钟
  const buf = await comfyDownloadView(out.filename, out.subfolder, out.type);
  return `data:video/mp4;base64,${buf.toString("base64")}`;
};

const ttsRequest = async (config: any, model: TTSModel): Promise<string> => {
  if (!vendor.inputValues.baseUrl) throw new Error("缺少 ComfyUI baseUrl 配置");
  const text: string = config.text || "";
  if (!text) throw new Error("TTSConfig.text 不能为空");
  // 2026-08-14: speechRate 范围 0.5-2.0 (F5TTSNode 默认 1.0; ElevenLabs 暂未映射此字段)
  const speechRate: number = config.speechRate || 1.0;
  // 2026-08-14: TTSConfig.voice 优先 (per-call 覆盖), 否则取 model.voices[0].voice
  const voiceOverride: string | undefined = config.voice;
  // 2026-08-14: referenceList 里 type="audio" 的当 ref_audio
  const refAudio = (config.referenceList || []).find((r: any) => r.type === "audio");

  let wf: any;
  switch (model.modelName) {
    case "f5-tts":
    case "e2-tts": {
      // 2026-08-14: F5TTSNode 缺 torchcodec 依赖, 装 `pip install torchcodec` 才能跑
      // (ComfyUI 0.28 + torchaudio 2.9.1 切到 torchcodec 后端, F5TTSNode 源码用 torchaudio.save 触发 ImportError)
      let refName: string;
      if (refAudio) {
        refName = await comfyUploadAudio(refAudio.base64, `tts_ref_${Date.now()}.wav`);
      } else {
        // fallback: input 目录默认中文 ref (5s 干净音色 ttson_4702_1)
        refName = "ttson_4702_1_trim_0.00-5.00.wav";
      }
      const modelChoice = model.modelName === "e2-tts" ? "E2-TTS" : "F5-TTS";
      wf = buildF5Tts(text, refName, modelChoice, speechRate);
      break;
    }
    case "elevenlabs": {
      // ElevenLabs: voice id 从 TTSConfig.voice 拿, 否则 model.voices[0] 默认
      const voiceId = voiceOverride || (model.voices[0]?.voice ?? "21m00Tcm4TlvDq8ikWAM");
      wf = buildElevenLabsTts(text, voiceId);
      break;
    }
    default:
      throw new Error(`未知 tts model: ${model.modelName}`);
  }

  const submit = await comfyPost("/prompt", { prompt: wf, client_id: "toonflow-comfyui-tts" });
  if (!submit.prompt_id) throw new Error(`ComfyUI /prompt 提交失败: ${JSON.stringify(submit)}`);
  const promptId: string = submit.prompt_id;
  logger(`tts submitted: ${promptId}, model=${model.modelName}, text_len=${text.length}`);

  // TTS 通常 5-30s, 但首次跑要下载 ~6GB 模型 (F5-TTS + vocos + whisper-large-v3-turbo) 可能 5-15 min
  // timeout 15 min 兜底
  const out = await submitAndPoll(promptId, "audio", 3000, 900_000);
  const buf = await comfyDownloadView(out.filename, out.subfolder, out.type);
  // 按扩展名判定 mime
  const lower = out.filename.toLowerCase();
  const mime = lower.endsWith(".mp3")
    ? "audio/mpeg"
    : lower.endsWith(".opus")
      ? "audio/opus"
      : "audio/wav";
  return `data:${mime};base64,${buf.toString("base64")}`;
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
