import { tool, jsonSchema, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import axios from "axios";
import ResTool from "@/socket/resTool";
import u from "@/utils";

const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空"),
  assetsId: z.number().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().nullable().describe("衍生资产资源路径"),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const assetItemSchema = z.object({
  id: z.number().describe("资产唯一标识"),
  name: z.string().describe("资产名称"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("资产类型"),
  prompt: z.string().describe("生成提示词"),
  desc: z.string().describe("资产描述"),
  derive: z.array(deriveAssetSchema).describe("衍生资产列表"),
});
const storyboardSchema = z.object({
  id: z.number().describe("分镜ID，必须为真实id"),
  duration: z.number().describe("持续时长(秒)"),
  prompt: z.string().describe("生成提示词"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
  index: z.number().nullable().optional().describe("分镜排序字段"),
});
const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("剧本内容"),
  scriptPlan: z.string().describe("拍摄计划"),
  assets: z.array(assetItemSchema).describe("全部资产（基础+衍生；基础资产的 derive 为空数组，衍生资产的 assetsId 字段指向父资产 ID）"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜面板"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

/**
 * 串行队列：确保 socket 操作排队执行，避免并发过高导致假死
 * @param delayMs 每个操作之间的最小间隔(ms)
 */
function createSocketQueue(delayMs = 800) {
  let lastPromise: Promise<any> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    lastPromise = lastPromise.then(
      () =>
        new Promise<T>((resolve, reject) => {
          setTimeout(() => fn().then(resolve, reject), delayMs);
        }),
    );
    return lastPromise;
  };
}

/**
 * 从 o_assets 实时加载当前 script 关联的全部资产（基础 + 衍生），并按 assetsId 关系拼装成
 * `{ baseAsset, derive[] }` 嵌套结构。schema 里 assetItemSchema.derive 是衍生资产数组。
 *
 * 修复 (8-14 主人反馈): 之前 get_flowData 的 assets 字段永远是空数组 — 读 o_agentWorkData 时缓存
 * 里就没这字段（autoPersistSubAgentOutput 只写 scriptPlan/storyboardTable/storyboard 三个 key），
 * 现算 fallback 又硬编码 `assets: []`，导致决策层 LLM 误判"基础资产也没有"而错误 block。
 *
 * 现在 assets 永远从 o_assets 现算，不走 o_agentWorkData 缓存。其它 key 保持原逻辑。
 */
async function loadAssetsFromDb(scriptId: number): Promise<any[]> {
  if (!scriptId) return [];
  // 取该 script 关联的全部 o_assets 行（基础 + 衍生），join o_image 拿 filePath
  const rows: any[] = await u
    .db("o_assets")
    .leftJoin("o_scriptAssets", "o_assets.id", "o_scriptAssets.assetId")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_scriptAssets.scriptId", scriptId)
    .select(
      "o_assets.id",
      "o_assets.name",
      "o_assets.type",
      "o_assets.prompt",
      "o_assets.describe as desc",
      "o_assets.assetsId as parentAssetId",
      "o_assets.remark",
      "o_image.filePath as src",
    )
    .orderBy("o_assets.id", "asc");

  if (!rows.length) return [];

  // 拆基础资产 (parentAssetId 为 null) 和衍生资产 (parentAssetId 不为 null)
  const baseById: Record<number, any> = {};
  const childrenByParent: Record<number, any[]> = {};
  for (const r of rows) {
    const item = {
      id: r.id,
      name: r.name,
      type: r.type,
      prompt: r.prompt ?? "",
      desc: r.desc ?? "",
      src: r.src ?? null,
    };
    if (r.parentAssetId == null) {
      baseById[r.id] = { ...item, derive: [] };
    } else {
      if (!childrenByParent[r.parentAssetId]) childrenByParent[r.parentAssetId] = [];
      childrenByParent[r.parentAssetId].push(item);
    }
  }
  // 把衍生资产挂到父资产的 derive 上
  for (const parentId of Object.keys(childrenByParent)) {
    const parent = baseById[Number(parentId)];
    if (parent) {
      parent.derive = childrenByParent[Number(parentId)];
    } else {
      // 衍生资产的父资产不在该 script 关联里 — 仍以"孤儿顶层"形式返回，避免数据丢失
      // （前端/审核会看到这条孤儿，不影响主流程）
      for (const child of childrenByParent[Number(parentId)]) {
        child.derive = [];
        baseById[`orphan_${child.id}`] = child;
      }
    }
  }
  return Object.values(baseById);
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const socketQueue = createSocketQueue(800);
  const workMap: Record<any, any> = {};
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: jsonSchema<{ key: keyof FlowData }>(
        z
          .object({
            key: keySchema.describe("数据key"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ key }) => {
        const thinking = msg.thinking(`正在获取${flowDataKeyLabels[key]}工作区数据...`);

        // 直接读 o_agentWorkData (key=productionAgent), 不再依赖 client emit.
        // 这样 sub-agent 自动写库后, 监督层一定能读到, 不再因 client 没接 reverse emit 而读空.
        const { projectId, scriptId } = resTool.data;
        const row: any = await u
          .db("o_agentWorkData")
          .where("projectId", String(projectId))
          .andWhere("episodesId", String(scriptId))
          .andWhere("key", "productionAgent")
          .first();

        // 如果 o_agentWorkData 没有该 scriptId 的行, 直接从 o_storyboard / o_script 现算一次
        // (用于回退到第一次启动的场景, 比如第一集直接 generate 而没先 saveFlowData)
        let flowData: any = null;
        if (row && row.data) {
          try {
            flowData = JSON.parse(row.data);
          } catch (e) {
            console.error("[tools] get_flowData parse error:", e);
          }
        }
        if (!flowData) {
          // 现算: 从 o_script 拿脚本, 从 o_storyboard 拿分镜
          const scriptData = await u.db("o_script").where("projectId", projectId).where("id", scriptId).first();
          const storyboardData = await u.db("o_storyboard").where("scriptId", scriptId).orderBy("id");
          const assets2Sb = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardData.map((s: any) => s.id)).orderBy("rowid");
          const map: Record<number, number[]> = {};
          assets2Sb.forEach((r: any) => {
            if (!map[r.storyboardId!]) map[r.storyboardId!] = [];
            map[r.storyboardId!].push(r.assetId!);
          });
          flowData = {
            script: scriptData?.content ?? "",
            scriptPlan: "",
            assets: [],
            storyboardTable: "",
            storyboard: storyboardData.map((s: any) => ({
              id: s.id,
              index: s.index,
              duration: s.duration ? +s.duration : 0,
              prompt: s.prompt,
              associateAssetsIds: map[s.id!] ?? [],
              src: s.filePath,
              state: s.state,
              videoDesc: s.videoDesc,
              shouldGenerateImage: s.shouldGenerateImage,
            })),
            workbench: { videoList: [] },
          };
        }

        // ★ 关键修复 (8-14 主人反馈): assets 字段必须从 o_assets 表实时查, 不走 o_agentWorkData 缓存.
        // 原因: autoPersistSubAgentOutput 只写 scriptPlan / storyboardTable / storyboard 三个 key,
        //       缓存里要么没 assets 字段, 要么是 []; 之前的现算 fallback 又硬编码 `assets: []`.
        //       决策层 LLM 看到 [] 就误判"基础资产也没有"而错误 block 流水线.
        // 现在: 无论走缓存还是现算, 都用 loadAssetsFromDb 实时覆盖 assets 字段.
        if (key === "assets") {
          flowData.assets = await loadAssetsFromDb(scriptId);
        }

        thinking.appendText(`获取到${flowDataKeyLabels[key]}(len=${JSON.stringify(flowData[key]).length}):\n` + JSON.stringify(flowData[key], null, 2).slice(0, 800));
        thinking.updateTitle(`获取${flowDataKeyLabels[key]}完成`);
        thinking.complete();
        if (workMap[key] && JSON.stringify(workMap[key]) === JSON.stringify(flowData[key])) {
          console.info(`[tools] get_flowData: ${flowDataKeyLabels[key]}数据未变化，无需更新`);
          return `${flowDataKeyLabels[key]}数据未变化，无需更新`;
        }
        workMap[key] = flowData[key];
        return flowData[key];
      },
    }),
    add_deriveAsset: tool({
      description: "新增或更新衍生资产",
      inputSchema: jsonSchema<{ assetsId: number; id: number | null; name: string; desc: string }>(
        z
          .object({
            assetsId: z.number().describe("关联的资产ID"),
            id: z.number().nullable().describe("衍生资产ID,如果新增则为空"),
            name: z.string().describe("衍生资产名称"),
            desc: z.string().describe("衍生资产描述"),
          })
          .toJSONSchema(),
      ),
      execute: async (raw) => {
        // 容错：LLM 偶尔传 "null" 字符串或空串，统一规范为 null
        const idRaw = raw.id as unknown;
        const normalizedId = idRaw === "null" || idRaw === "" || idRaw === undefined ? null : (idRaw as number | null);
        const deriveAsset = { ...raw, id: normalizedId };

        const thinking = msg.thinking("正在操作资产...");
        const { projectId, scriptId } = resTool.data;
        const startTime = Date.now();
        const parentAssets = await u.db("o_assets").where("id", deriveAsset.assetsId).select("id", "type").first();
        if (!parentAssets) return "关联的资产不存在";

        const data = {
          id: deriveAsset.id ?? undefined,
          assetsId: deriveAsset.assetsId,
          projectId,
          name: deriveAsset.name,
          type: parentAssets.type,
          describe: deriveAsset.desc,
          startTime,
        };
        if (deriveAsset.id) {
          await u.db("o_assets").where("id", deriveAsset.id).update(data);
          thinking.appendText(`已更新衍生资产，ID: ${deriveAsset.id}\n`);
        } else {
          const [insertedId] = await u.db("o_assets").insert(data);
          data.id = insertedId;
          await u.db("o_scriptAssets").insert({ scriptId, assetId: insertedId });
          thinking.appendText(`已新增衍生资产，ID: ${insertedId}\n`);
        }
        const res = await new Promise((resolve) => socket.emit("addDeriveAsset", data, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "操作成功";
      },
    }),
    del_deriveAsset: tool({
      description: "删除衍生资产",
      inputSchema: jsonSchema<{ assetsId: number; id: number }>(
        z
          .object({
            assetsId: z.number().describe("关联的资产ID"),
            id: z.number().describe("衍生资产ID"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ assetsId, id }) => {
        const thinking = msg.thinking("正在操作资产...");
        const { scriptId } = resTool.data;
        await u.db("o_assets").where("id", id).del();
        await u.db("o_scriptAssets").where({ scriptId, assetId: id }).del();
        thinking.appendText(`已删除衍生资产，ID: ${id}\n`);
        const res = await new Promise((resolve) => socket.emit("delDeriveAsset", { assetsId, id }, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "删除成功";
      },
    }),
    generate_deriveAsset: tool({
      description: "生成衍生资产图片",
      inputSchema: jsonSchema<{ ids: number[] }>(
        z
          .object({
            ids: z.array(z.number()).describe("需要生成的 衍生资产ID"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成衍生资产...");
        new Promise((resolve) => socket.emit("generateDeriveAsset", { ids }, (res: any) => resolve(res)))
          .then((res) => {
            thinking.appendText(`已生成衍生资产，ID: ${JSON.stringify(res, null, 2)}\n`);
            thinking.updateTitle("衍生资产开始完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("衍生资产生成失败:\n" + u.error(e).message);
            thinking.updateTitle("衍生资产生成失败");
            thinking.complete();
          });

        return "开始生成衍生资产";
      },
    }),
    generate_storyboard: tool({
      description: "生成分镜图片",
      inputSchema: jsonSchema<{ ids: number[] }>(
        z
          .object({
            ids: z.array(z.number()).describe("必须获取真实的分镜ID，支持批量生成"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成分镜...");
        socketQueue(
          () =>
            new Promise((resolve, reject) =>
              socket.emit("generateStoryboard", { ids }, (res: any) => {
                if (res?.error) return reject(new Error(res.error));
                resolve(res);
              }),
            ),
        )
          .then((res) => {
            thinking.appendText("生成的分镜数据:\n" + JSON.stringify(res, null, 2));
            thinking.updateTitle("分镜生成完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("分镜生成失败:\n" + u.error(e).message);
            thinking.updateTitle("分镜生成失败");
            thinking.complete();
          });

        return "开始生成分镜";
      },
    }),
    add_flowData_storyboard: tool({
      description: "新增分镜面板到工作区",
      inputSchema: jsonSchema<{
        videoDesc: string;
        prompt: string | null;
        track: string;
        duration: number;
        associateAssetsIds: number[] | null;
        shouldGenerateImage: string;
      }>(
        z
          .object({
            videoDesc: z.string().describe("画面描述、场景、关联资产名称、时长、景别、运镜、角色动作、情绪、光影氛围、台词、音效、关联资产ID"),
            prompt: z.string().nullable().describe("分镜图片提示词"),
            track: z.string().describe("分组"),
            duration: z.number().describe("视频推荐时间"),
            associateAssetsIds: z.array(z.number()).nullable().describe("该分镜所需的资产ID列表"),
            shouldGenerateImage: z.enum(["true", "false"]).describe("是否需要生成分镜图片"),
          })
          .toJSONSchema(),
      ),
      execute: async (raw) => {
        const thinking = msg.thinking("正在新增 分镜面板 数据...");
        const { projectId, scriptId } = resTool.data;
        if (!projectId || !scriptId) {
          thinking.appendText("缺少 projectId 或 scriptId，无法新增分镜");
          thinking.updateTitle("新增分镜失败(缺少上下文)");
          thinking.complete();
          return "新增分镜失败: 缺少 projectId 或 scriptId";
        }
        // 为避免依赖前端 socket 在线接收 addStoryboard 广播(导致永不落库),
        // 改为执行层直接走 HTTP API: POST /api/production/storyboard/batchAddStoryboardInfo
        // 该接口同时落 o_storyboard + 写 o_assets2Storyboard 资产关联 + 按 track 分配 trackId
        const pageData = {
          prompt: raw.prompt ?? "",
          duration: raw.duration ?? 5,
          track: raw.track,
          state: "待生成",
          src: null as string | null,
          videoDesc: raw.videoDesc,
          shouldGenerateImage: raw.shouldGenerateImage === "true" ? 1 : 0,
          associateAssetsIds: raw.associateAssetsIds ?? [],
        };
        try {
          const authToken = (resTool.socket?.handshake?.auth || {})["token"] as string | undefined;
          const port = Number(process.env.PORT) || 10588;
          const baseUrl = `http://127.0.0.1:${port}/api/production/storyboard/batchAddStoryboardInfo`;
          const headers: Record<string, string> = {};
          if (authToken) {
            // socket.handshake.auth.token 可能已带 "Bearer " 前缀(login 返回如此),
            // 先剥掉再拼, 避免出现 "Bearer Bearer xxx" 导致 jwt.verify 失败(401)
            const bare = String(authToken).replace(/^Bearer\s+/i, "");
            const hKey = "authorization";
            headers[hKey] = `Bearer ${bare}`;
          }
          const resp = await axios.post(baseUrl, { data: [pageData], scriptId, projectId }, { headers, timeout: 15000 });
          // 2026-08-31: 取 batchAddStoryboardInfo 新增的 insertedIds[0] 才是本次插入的真实自增 id.
          // 之前取 data.data[0].id 永远拿到脚本首条 (id=1), 导致 o_agentWorkData.storyboard[] JSON
          // 里所有条目 id 被推为 1, 引发分镜面板 id 唯一性故障.
          const insertedId = resp?.data?.data?.insertedIds?.[0];
          // 分镜面板前端读的是 o_agentWorkData.productionAgent.storyboard[] JSON,
          // 不是 o_storyboard 表。落表后同步写 JSON, 模拟前端 socket 接收 addStoryboard 时
          // push 到本地 storyboard 再 setFlowData() 保存的效果, 否则面板仍显示为空。
          if (insertedId) {
            const wbRow: any = await u
              .db("o_agentWorkData")
              .where("projectId", String(projectId))
              .andWhere("episodesId", String(scriptId))
              .andWhere("key", "productionAgent")
              .first();
            let wbData: any = {};
            if (wbRow && wbRow.data) {
              try { wbData = JSON.parse(wbRow.data); } catch {}
            }
            const sbList = Array.isArray(wbData.storyboard) ? wbData.storyboard : [];
            sbList.push({
              id: insertedId,
              duration: pageData.duration,
              prompt: pageData.prompt,
              associateAssetsIds: pageData.associateAssetsIds,
              src: null,
              state: pageData.state,
              videoDesc: pageData.videoDesc,
              shouldGenerateImage: pageData.shouldGenerateImage,
              track: pageData.track,
            });
            wbData.storyboard = sbList;
            if (wbRow) {
              await u.db("o_agentWorkData").where({ id: wbRow.id }).update({ data: JSON.stringify(wbData) });
            } else {
              await u.db("o_agentWorkData").insert({ projectId, episodesId: scriptId, key: "productionAgent", data: JSON.stringify(wbData) });
            }
          }
          thinking.appendText("新增的分镜数据:\n" + JSON.stringify(pageData, null, 2) + `\n分镜ID: ${insertedId ?? "?"}`);
          thinking.updateTitle(`新增分镜成功(ID ${insertedId ?? "?"})`);
          thinking.complete();
          return { success: true, id: insertedId };
        } catch (e: any) {
          const errMsg = e?.response?.data?.message || e?.message || "新增分镜失败";
          thinking.appendText("新增的分镜数据:\n" + JSON.stringify(pageData, null, 2) + `\n错误: ${errMsg}`);
          thinking.updateTitle("新增分镜失败");
          thinking.complete();
          return `新增分镜失败: ${errMsg}`;
        }
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
