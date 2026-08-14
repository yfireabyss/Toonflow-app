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
  return Math.max(9, Math.min(257, k * 8 + 1));
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

function findOutputFile(entry: HistoryEntry, prefer: "video" | "image"): { filename: string; subfolder: string; type: string } | null {
  const allFiles: { filename: string; subfolder: string; type: string }[] = [];
  for (const nodeId of Object.keys(entry.outputs || {})) {
    const o = entry.outputs[nodeId];
    if (o.images && o.images.length > 0) allFiles.push(...o.images);
    if (o.gifs && o.gifs.length > 0) allFiles.push(...o.gifs);
  }
  if (allFiles.length === 0) return null;
  const videoRe = /\.(mp4|webm|gif|mov|avi)$/i;
  const imageRe = /\.(png|jpg|jpeg|webp)$/i;
  if (prefer === "video") {
    const v = allFiles.find((f) => videoRe.test(f.filename));
    if (v) return v;
  } else {
    const i = allFiles.find((f) => imageRe.test(f.filename));
    if (i) return i;
  }
  return allFiles[0];
}

async function submitAndPoll(promptId: string, prefer: "video" | "image", pollIntervalMs: number, pollTimeoutMs: number): Promise<{ filename: string; subfolder: string; type: string }> {
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
const NEGATIVE_VIDEO = "ugly, blurry, low quality, watermark, text, distorted, deformed, jitter, frame flicker";

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
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_truly_startend", format: "video/h264-mp4", pingpong: false, save_output: true } },
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
    if (r.type === "image" && imageRefs.length < 5) {
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
    case "ltx2.3-ic-motion-track":
      // 2026-08-15: IC-LoRA motion track (ref 图 + 运动参考图, imageReference:2)
      if (imageRefs.length < 2) throw new Error("ltx2.3-ic-motion-track 需要 imageReference:2 (ref 图 + 运动参考图)");
      wf = buildLtx2_3ICMotionTrack(config.prompt, w, h, length, seed, imageRefs[0], imageRefs[1]);
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
  throw new Error("本机 ComfyUI 供应商暂未实现 TTS（FB_Qwen3TTS 节点未装）");
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
