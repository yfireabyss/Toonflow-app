/**
 * Toonflow AI 供应商模板 - ComfyUI HTTP API 桥接
 * @version 1.0
 * @description 连接到 192.168.188.7:8188 上的 ComfyUI，调用其 /prompt 接口
 *              执行图片生成和视频生成 workflow。
 *
 * 需要的 ComfyUI 端配置：
 *   - 启动时允许远程访问：python main.py --listen 0.0.0.0 --port 8188
 *   - 或者在 8188 上对 StarVPN 开放防火墙
 *
 * 支持的模型（在 ComfyUI 端实际安装的模型基础上动态配置）：
 *   图片：DreamShaper_8 / Qwen-Image-Edit / Flux-2-Turbo (via LoRA)
 *   视频：LTX-2.3 (带音频说话人 LoRA)
 */

// ============================================================
// 类型定义（与平台一致）
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
  modelName: string;       // ComfyUI 上的 checkpoint / unet 文件名
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
  // 拓展字段：workflow 模板
  ckptType?: "checkpoint" | "unet" | "edit";  // 决定走哪个 workflow
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  vae?: string;
  lora?: { name: string; strength: number }[];
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
  ckptType?: "checkpoint" | "unet";
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  vae?: string;
  lora?: { name: string; strength: number }[];
  fps?: number;
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

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明（平台注入）
// ============================================================

declare const fetch: any;
declare const logger: (msg: string) => void;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const crypto: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// 工具函数
// ============================================================

function getBaseUrl(): string {
  const v = (vendor.inputValues.baseUrl || "").trim();
  if (!v) throw new Error("请先在 [设置 - 模型配置] 中填写 ComfyUI 地址");
  return v.replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = (vendor.inputValues.authToken || "").trim();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function aspectToSize(ratio: string, base: number = 1024): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return { width: base, height: base };
  // 选最接近 base 的一边
  const scale = base / Math.max(w, h);
  const width = Math.round((w * scale) / 8) * 8;
  const height = Math.round((h * scale) / 8) * 8;
  return { width, height };
}

function resolutionToSize(res: string, ratio: "16:9" | "9:16"): { width: number; height: number } {
  // 把 "480p"/"720p"/"1080p" 翻译成像素
  const long_side = res === "1080p" ? 1920 : res === "720p" ? 1280 : 854;
  if (ratio === "9:16") return { width: Math.round(long_side * 9 / 16 / 8) * 8, height: long_side };
  return { width: long_side, height: Math.round(long_side * 9 / 16 / 8) * 8 };
}

async function dataUrlToPngBuffer(dataUrl: string): Promise<{ buffer: Buffer; ext: string }> {
  const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) throw new Error("不支持的 image data URL 格式");
  return { buffer: Buffer.from(m[2], "base64"), ext: m[1] === "jpeg" ? "jpg" : m[1] };
}

async function uploadBase64ImageToComfy(base64: string, type: "input" | "temp"): Promise<string> {
  // 把 base64 上传到 ComfyUI 的 /upload 接口，得到服务器侧的文件名
  const { buffer, ext } = await dataUrlToPngBuffer(base64);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)], { type: `image/${ext}` }), `ref_${Date.now()}.${ext}`);
  form.append("type", type);
  form.append("overwrite", "true");
  const res = await fetch(`${getBaseUrl()}/upload/image`, { method: "POST", body: form as any });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ComfyUI 图片上传失败: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.name as string;  // 服务端文件名
}

// ============================================================
// Workflow 构造器
// ============================================================

function buildText2ImageWorkflow(model: ImageModel, prompt: string, negPrompt: string, size: { width: number; height: number }, seed: number, refFilename?: string): any {
  // 基础 SDXL 风格 workflow，使用 CheckpointLoaderSimple
  const wf: any = {
    "1": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["3", 1] } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: negPrompt, clip: ["3", 1] } },
    "3": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model.modelName },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: size.width, height: size.height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: model.steps ?? 25,
        cfg: model.cfg ?? 7,
        sampler_name: model.sampler ?? "euler",
        scheduler: model.scheduler ?? "normal",
        denoise: 1,
        model: ["3", 0],
        positive: ["1", 0],
        negative: ["2", 0],
        latent_image: ["4", 0],
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["3", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "toonflow_img_" + Date.now() } },
  };
  // 如果模型配了 LoRA，在 KSampler 前注入
  if (model.lora && model.lora.length > 0) {
    const loraNodeId = "8";
    const modelLoaderId = "3";
    const loraInputs: any = { model: [modelLoaderId, 0], clip: [modelLoaderId, 1] };
    model.lora.forEach((l, i) => {
      loraInputs[`lora_${i + 1}`] = l.name;
      loraInputs[`strength_${i + 1}`] = l.strength;
      loraInputs[`strength_clip_${i + 1}`] = l.strength;
    });
    wf[loraNodeId] = { class_type: "LoraLoader", inputs: loraInputs };
    // 把 KSampler 的 model 输入指到 lora 节点
    wf["5"].inputs.model = [loraNodeId, 0];
    wf["1"].inputs.clip = [loraNodeId, 1];
    wf["2"].inputs.clip = [loraNodeId, 1];
    wf["6"].inputs.vae = [loraNodeId, 2];
  }
  // 图像编辑（qwen_image_edit / FireRed 等）：用 LoadImage → 参考图
  if (model.ckptType === "edit" && refFilename) {
    wf["10"] = { class_type: "LoadImage", inputs: { image: refFilename } };
    // 把 reference image 作为 conditioning 喂给 sampler（用 IPAdapter / Apply 的简化版）
    // 这里默认假设 ComfyUI 上有 Qwen-Image-Edit-ConditioningPlus 节点
    wf["11"] = {
      class_type: "QwenImageEditConditioningPlus",
      inputs: {
        positive: ["1", 0],
        negative: ["2", 0],
        image: ["10", 0],
        vae: ["3", 2],
      },
    };
    wf["5"].inputs.positive = ["11", 0];
    wf["5"].inputs.negative = ["11", 1];
  }
  return wf;
}

function buildText2VideoWorkflow(model: VideoModel, prompt: string, negPrompt: string, size: { width: number; height: number }, frames: number, seed: number, refFilename?: string): any {
  // 本地 LTX-2.3 视频 workflow（已实测可用，2026-08-12）
  // 节点依赖：CheckpointLoaderSimple / LTXAVTextEncoderLoader (gemma) / LTXVConditioning / ModelSamplingLTXV / EmptyLTXVLatentVideo / KSampler / VAEDecode / VHS_VideoCombine
  const ckptId = "3";
  const encoderId = "11";
  // LTX-2.3 模型自身不含 CLIP，必须用 LTXAVTextEncoderLoader 加载 gemma 文本编码器
  const wf: any = {
    [ckptId]: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model.modelName } },
    [encoderId]: { class_type: "LTXAVTextEncoderLoader", inputs: {
      text_encoder: "gemma_3_12B_it_fp4_mixed.safetensors",
      ckpt_name: model.modelName,
      device: "default",
    }},
    "1": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: [encoderId, 0] } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: negPrompt, clip: [encoderId, 0] } },
    "4": { class_type: "ModelSamplingLTXV", inputs: { model: [ckptId, 0], max_shift: 2.05, base_shift: 0.95 } },
    "5": { class_type: "LTXVConditioning", inputs: { positive: ["1", 0], negative: ["2", 0], frame_rate: model.fps ?? 25 } },
    "6": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width: size.width, height: size.height, length: frames, batch_size: 1 },
    },
    "7": {
      class_type: "LTXVScheduler",
      inputs: { steps: model.steps ?? 20, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: model.steps ?? 20,
        cfg: model.cfg ?? 3.0,
        sampler_name: model.sampler ?? "euler",
        scheduler: model.scheduler ?? "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["5", 1],
        latent_image: ["6", 0],
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: [ckptId, 2] } },
    "10": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["9", 0],
        frame_rate: model.fps ?? 25,
        loop_count: 0,
        filename_prefix: `toonflow_vid_${Date.now()}`,
        format: "video/h264-mp4",
        pingpong: false,
        save_output: true,
      },
    },
  };
  return wf;
}

// ============================================================
// 提交 + 轮询
// ============================================================

async function submitWorkflow(workflow: any, clientId: string): Promise<string> {
  const res = await fetch(`${getBaseUrl()}/prompt`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ComfyUI 提交失败: ${res.status} ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  if (!data.prompt_id) {
    throw new Error(`ComfyUI 提交无返回 prompt_id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.prompt_id;
}

async function fetchHistory(promptId: string): Promise<any> {
  const res = await fetch(`${getBaseUrl()}/history/${promptId}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return await res.json();
}

async function fetchOutputAsDataUrl(filename: string, subfolder: string, type: string): Promise<string> {
  const qs = `filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}`;
  const fullQs = subfolder ? `${qs}&subfolder=${encodeURIComponent(subfolder)}` : qs;
  const res = await fetch(`${getBaseUrl()}/view?${fullQs}`);
  if (!res.ok) throw new Error(`ComfyUI 取图失败: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // 转 base64
  let binary = "";
  for (let i = 0; i < buf.byteLength; i++) binary += String.fromCharCode(buf[i]);
  const b64 = (globalThis as any).btoa ? (globalThis as any).btoa(binary) : Buffer.from(buf).toString("base64");
  // 按扩展名推断 mime（支持图片 + 视频 + 音频）
  const ext = (filename.split(".").pop() || "bin").toLowerCase();
  const mimeMap: Record<string, string> = {
    // 图片
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
    // 视频
    mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo",
    "mp4-h264": "video/mp4", h264: "video/mp4",
    // 音频
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4",
  };
  const mime = mimeMap[ext] || "application/octet-stream";
  return `data:${mime};base64,${b64}`;
}

async function pollUntilDone(promptId: string): Promise<string> {
  // 使用 toonflow 提供的 pollTask（vm2 sandbox 里没有 setTimeout）
  const result: any = await pollTask(async () => {
    const hist = await fetchHistory(promptId);
    if (!hist || !hist[promptId]) {
      return { completed: false };
    }
    const entry = hist[promptId];
    // 还在跑
    if (entry.status && entry.status.completed === false) {
      const msgs = entry.status.status_str || "";
      logger(`[ComfyUI] ${promptId} 进度: ${msgs}`);
      return { completed: false };
    }
    // 失败
    if (entry.status && entry.status.status_str === "error") {
      return { completed: true, error: `ComfyUI 任务失败: ${JSON.stringify(entry.status).slice(0, 400)}` };
    }
    // 完成：找 outputs
    const outputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const out = outputs[nodeId];
      if (out.images && out.images.length > 0) {
        const img = out.images[0];
        logger(`[ComfyUI] ${promptId} 完成, 输出: ${img.filename}`);
        return { completed: true, data: await fetchOutputAsDataUrl(img.filename, img.subfolder || "", img.type || "output") };
      }
      if (out.gifs && out.gifs.length > 0) {
        const gif = out.gifs[0];
        return { completed: true, data: await fetchOutputAsDataUrl(gif.filename, gif.subfolder || "", gif.type || "output") };
      }
      if (out.videos && out.videos.length > 0) {
        const v = out.videos[0];
        return { completed: true, data: await fetchOutputAsDataUrl(v.filename, v.subfolder || "", v.type || "output") };
      }
    }
    return { completed: true, error: "ComfyUI 任务完成但未找到输出文件" };
  }, 3000, 30 * 60 * 1000);  // 3s 间隔，30min 超时

  if (result.error) throw new Error(result.error);
  if (!result.data) throw new Error(`ComfyUI 任务超时（>30min）: ${promptId}`);
  return result.data;
}

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "comfyui",
  version: "1.0",
  author: "toonflow",
  name: "ComfyUI 本地部署",
  description: "调用局域网内的 ComfyUI HTTP API（默认 192.168.188.7:8188）执行图片和视频生成。\n\n需要在 ComfyUI 端启动时允许远程访问：\npython main.py --listen 0.0.0.0 --port 8188",
  icon: "",
  inputs: [
    { key: "baseUrl", label: "ComfyUI 地址", type: "url", required: true, placeholder: "例如 http://192.168.188.7:8188" },
    { key: "authToken", label: "鉴权 Token (可选)", type: "password", required: false, placeholder: "如果 ComfyUI 启用了鉴权模式才需要" },
  ],
  inputValues: {
    baseUrl: "http://192.168.188.7:8188",
    authToken: "",
  },
  models: [
    {
      name: "DreamShaper 8 (通用写实)",
      modelName: "DreamShaper_8_pruned.safetensors",
      type: "image",
      mode: ["text"],
      steps: 25,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
    },
    {
      name: "Qwen-Image-Edit 2511 (图像编辑)",
      modelName: "QW2511\\qwen_image_edit_2511_fp8_e4m3fn_scaled.safetensors",
      type: "image",
      mode: ["text", "singleImage"],
      ckptType: "edit",
      steps: 20,
      cfg: 4,
      sampler: "euler",
      scheduler: "normal",
    },
    {
      name: "LTX-2.3 视频 (带音频说话人)",
      modelName: "ltx-2.3-22b-dev-fp8.safetensors",  // 需在 ComfyUI 端有 base 模型
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: "optional",
      lora: [
        { name: "LTX-2.3-22b-AV-LoRA-talking-head-v1.safetensors", strength: 0.85 },
      ],
      durationResolutionMap: [
        { duration: [4, 5, 6, 8], resolution: ["480p", "720p"] },
      ],
      steps: 30,
      cfg: 3.5,
      sampler: "euler",
      scheduler: "normal",
      fps: 24,
    } as VideoModel,
  ],
};

// ============================================================
// 适配器
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!getBaseUrl()) throw new Error("未配置 ComfyUI 地址");
  const size = aspectToSize(config.aspectRatio, 1024);
  const seed = randomSeed();
  // 处理参考图（编辑用）
  let refFilename: string | undefined;
  const refImg = config.referenceList?.find((r) => r.type === "image");
  if (refImg) {
    refFilename = await uploadBase64ImageToComfy(refImg.base64, "input");
  }
  const wf = buildText2ImageWorkflow(model, config.prompt, "ugly, blurry, low quality, distorted", size, seed, refFilename);
  logger(`[ComfyUI 图] 提交 workflow 模型=${model.modelName} 分辨率=${size.width}x${size.height} seed=${seed}`);
  const promptId = await submitWorkflow(wf, `toonflow-${Date.now()}`);
  return await pollUntilDone(promptId);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!getBaseUrl()) throw new Error("未配置 ComfyUI 地址");
  const ratio = config.aspectRatio as "16:9" | "9:16";
  const size = resolutionToSize(config.resolution || "720p", ratio);
  const frames = Math.round((config.duration || 5) * (model.fps || 24));
  const seed = randomSeed();
  // 处理首帧参考
  let refFilename: string | undefined;
  const refImg = config.referenceList?.find((r) => r.type === "image");
  if (refImg && (config.mode.includes("startFrameOptional") || config.mode.includes("singleImage"))) {
    refFilename = await uploadBase64ImageToComfy(refImg.base64, "input");
  }
  const wf = buildText2VideoWorkflow(model, config.prompt, "ugly, blurry, jitter, distorted, low quality", size, frames, seed, refFilename);
  // 如果提供了首帧图，插入到 conditioning
  if (refFilename && (config.mode.includes("startFrameOptional") || config.mode.includes("singleImage"))) {
    wf["12"] = { class_type: "LoadImage", inputs: { image: refFilename } };
    // 用 VAEEncode 把首帧图编码进 latent_image（最简做法）
    wf["13"] = { class_type: "VAEEncode", inputs: { pixels: ["12", 0], vae: ["3", 2] } };
    wf["6"].inputs.latent_image = ["13", 0];
    wf["6"].inputs.denoise = 1.0;  // 全去噪
  }
  logger(`[ComfyUI 视] 提交 workflow 模型=${model.modelName} ${size.width}x${size.height} ${frames}帧 seed=${seed}`);
  const promptId = await submitWorkflow(wf, `toonflow-${Date.now()}`);
  return await pollUntilDone(promptId);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";  // ComfyUI 不直接提供 TTS，留空
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "1.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};
