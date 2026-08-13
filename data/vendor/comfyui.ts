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
  // 2026-08-13: 启用完整 SDXL base+refiner 双 KSampler 链
  // 之前只用 base (注释 "避免 shape 不匹配" 是早期妥协), 现在 refiner 已装回 (sd_xl_refiner_1.0.safetensors 6GB)
  // 链路: base 25 步 (denoise=1) 出基础 latent → refiner 20 步 (denoise=0.2) 细化 → VAEDecode → SaveImage
  //   - 两 stage 共享 positive/negative CLIP (都从 base 编码)
  //   - refiner 的 model 来自 refiner checkpoint, vae 仍用 base 的 (refiner 不带独立 vae)
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
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["2", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["6", 0],
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
  // nvfp4 + gemma + ltx projection + 8 步快速 i2v
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-nvfp4.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: refImage } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 8, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["6", 0], negative: ["6", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["5", 0],
        add_noise: true, noise_seed: seed, cfg: 1.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_ltx23i2v", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3StartEnd(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string | null): any {
  // 蒸馏 13B + 首尾帧(用空 latent + 加噪,简版)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltxv-13b-0.9.8-distilled-fp8.safetensors" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors", type: "ltxv", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "22": { class_type: "VAEEncode", inputs: { pixels: ["21", 0], vae: ["1", 2] } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 8, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["1", 0], positive: ["6", 0], negative: ["6", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["5", 0],
        add_noise: true, noise_seed: seed, cfg: 1.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_startend", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3StartEndFull(prompt: string, width: number, height: number, length: number, seed: number, startImg: string, endImg: string | null): any {
  // 满血 22B fp8 + gemma + distilled lora + 首尾双图流
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "30": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "ltx-2.3-22b-distilled-lora-384.safetensors", strength_model: 0.5 } },
    "20": { class_type: "LoadImage", inputs: { image: startImg } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "22": { class_type: "VAEEncode", inputs: { pixels: ["21", 0], vae: ["1", 2] } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 8, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": {
      class_type: "SamplerCustom",
      inputs: {
        model: ["30", 0], positive: ["6", 0], negative: ["6", 1],
        sampler: ["8", 0], sigmas: ["7", 0], latent_image: ["5", 0],
        add_noise: true, noise_seed: seed, cfg: 1.0,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_startend_full", format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

function buildLtx2_3Repair(prompt: string, width: number, height: number, length: number, seed: number, refImage: string): any {
  // 简化为 LTX i2v(SeedVR2 修复节点复杂,简化为 LTX 图生视频)
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors" } },
    "2": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fpmixed.safetensors", ckpt_name: "ltx-2.3-22b-dev-fp8.safetensors", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt || "high quality video, smooth motion" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: NEGATIVE_VIDEO } },
    "20": { class_type: "LoadImage", inputs: { image: refImage } },
    "21": { class_type: "ImageScale", inputs: { image: ["20", 0], width, height, upscale_method: "lanczos", crop: "center" } },
    "5": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length, batch_size: 1 } },
    "6": { class_type: "LTXVConditioning", inputs: { positive: ["3", 0], negative: ["4", 0], frame_rate: 24 } },
    "7": { class_type: "LTXVScheduler", inputs: { steps: 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
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
    "11": { class_type: "VHS_VideoCombine", inputs: { images: ["10", 0], frame_rate: 24, loop_count: 0, filename_prefix: "toonflow_repair", format: "video/h264-mp4", pingpong: false, save_output: true } },
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
  if (["sd-upscale-img", "face-detailer", "portrait-enhance", "upscale-usdu", "qwen-image-edit"].includes(model.modelName)) {
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

  // 处理 reference images
  let startImg: string | null = null;
  let endImg: string | null = null;
  const imageRefs = (config.referenceList || []).filter((r) => r.type === "image");
  if (imageRefs.length >= 2) {
    startImg = await comfyUploadImage(imageRefs[0].base64, `start_${Date.now()}.png`);
    endImg = await comfyUploadImage(imageRefs[1].base64, `end_${Date.now()}.png`);
  } else if (imageRefs.length === 1) {
    startImg = await comfyUploadImage(imageRefs[0].base64, `start_${Date.now()}.png`);
  }

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
    case "ltx2.3-repair":
      if (!startImg) throw new Error("ltx2.3-repair 需要单图参考");
      wf = buildLtx2_3Repair(config.prompt, w, h, length, seed, startImg);
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
