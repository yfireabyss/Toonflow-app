# ComfyUI vendor 工作流目录

本目录存放 ComfyUI vendor 调用的工作流 JSON 文件.

## 命名规则

按 `modelName` 命名:
- `toonflow_character_scaill.json` (角色设定图, SCAIL 多参考)
- `toonflow_character_qwen_multiangle.json` (角色多角度, Qwen)
- `toonflow_storyboard_zimage.json` (分镜画面, Z-image 高清)
- `toonflow_storyboard_default.json` (分镜画面, 默认自动出图)
- `toonflow_video_ltx23_nvfp4.json` (镜头视频, LTX-2.3 nvfp4)
- `toonflow_video_wananimate_single.json` (镜头视频, WanAnimate 单人)
- `toonflow_tts_qwen3.json` (TTS 配音, Qwen3-TTS)
- `toonflow_lipsync_liveportrait.json` (唇形/微表情, LivePortrait)

## JSON 格式要求

必须包含顶层字段 `__toonflow_meta__` 标记关键节点 ID:

\`\`\`json
{
  "__toonflow_meta__": {
    "promptNodeId": "10",        // CLIPTextEncode 节点 ID (用于注入 prompt)
    "referenceNodeIds": ["20", "21"],  // LoadImage 节点 ID 数组 (用于上传参考图)
    "seedNodeId": "30",           // KSampler 节点 ID (自动随机种子)
    "resolutionNodeId": "40",     // (视频) 分辨率 widget 节点 ID
    "durationNodeId": "41",       // (视频) 时长 widget 节点 ID
    "voiceNodeId": "50",          // (TTS) 音色 widget 节点 ID
    "speechRateNodeId": "51",
    "pitchRateNodeId": "52",
    "volumeNodeId": "53"
  },
  "10": {                         // 节点 ID 作为 key, ComfyUI Prompt 格式
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "" }
  },
  ... 其他节点
}
\`\`\`

## 工作流导出流程

1. 在 10600 ComfyUI 浏览器设计/调试工作流
2. 工作流能跑通后, 点击 "Save (API Format)" 导出为 JSON
3. 复制 JSON 到本目录, 按上面命名规则命名
4. 在 JSON 顶部加 `__toonflow_meta__` 字段, 标记关键节点 ID
5. Toonflow 供应商配置: 选 "ComfyUI 自托管" → 填 baseUrl (http://192.168.188.7:8188) → 启用对应 model

## 占位状态

当前所有工作流文件都未放置. 部署时按上述流程从 10600 ComfyUI 导出.
