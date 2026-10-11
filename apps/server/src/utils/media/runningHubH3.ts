import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "@toonflow/file";
import type { ProviderTools } from "@toonflow/providers";
import { resolveWorkspacePath } from "@/utils/workspace/files";

const serviceName = "runninghub-minimax-h3-independent";
const maxOutputSize = 100 * 1024 * 1024;

function serviceBase() {
  const base = process.env.RH_H3_BASE || "http://127.0.0.1:4317";
  const url = new URL(base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("RunningHub H3 仅支持本机 127.0.0.1 服务地址");
  }
  return url.origin;
}

async function serviceToken() {
  const directory = process.env.RH_H3_HOME || join(homedir(), ".runninghub-h3-service");
  const value = (await readFile(resolve(directory, "service.token"), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("本机 H3 服务令牌无效，请先启动 RunningHub H3 服务");
  return value;
}

type ServiceMethod = "GET" | "POST" | "PATCH";

/** Server-side management proxy. The service token is never returned to the webview. */
export async function runningHubH3ServiceRequest(path: string, method: ServiceMethod = "GET", body?: unknown): Promise<Record<string, unknown>> {
  if (!/^\/api\/[a-zA-Z0-9/_-]+$/.test(path)) throw Object.assign(new Error("无效的 H3 服务路径"), { status: 400 });
  let base: string;
  let token: string;
  try {
    base = serviceBase();
    token = await serviceToken();
  } catch {
    throw Object.assign(new Error("本机 RunningHub H3 服务未运行或未完成初始化"), { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw Object.assign(new Error("无法连接本机 RunningHub H3 服务，请先启动本机服务"), { status: 503 });
  }

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : `本机 RunningHub H3 服务返回 HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status >= 500 ? 502 : response.status });
  }
  return result;
}

export function createRunningHubH3Tools(cwd: string, signal?: AbortSignal): NonNullable<ProviderTools["runningHubH3"]> {
  async function callService(base: string, token: string, path: string, body?: unknown, ignoreOperationSignal = false) {
    if (!ignoreOperationSignal) signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal && !ignoreOperationSignal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
        redirect: "error",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("无法连接本机 RunningHub H3 服务，请确认服务正在运行");
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error || `本机 RunningHub H3 服务返回 HTTP ${response.status}`);
    }
    return response;
  }

  function references(request: VideoRequest) {
    const result: { path: string; kind: "image" | "audio" | "video"; role: string }[] = [];
    const append = async (input: MediaInput | undefined, kind: "image" | "audio" | "video", role = "reference") => {
      if (!input) return;
      if (input.type !== "base64" || typeof input.name !== "string" || !input.name) {
        throw new Error("RunningHub H3 参考素材必须来自当前项目中的本地文件");
      }
      const resolved = await resolveWorkspacePath(cwd, input.name);
      result.push({ path: resolved.path, kind, role });
    };
    return (async () => {
      for (const image of request.images ?? []) await append(image, "image");
      await append(request.firstFrame, "image", "first-frame");
      await append(request.lastFrame, "image", "last-frame");
      for (const video of request.videos ?? []) await append(video, "video");
      for (const audio of request.audios ?? []) await append(audio, "audio");
      return result;
    })();
  }

  return {
    async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
      const base = serviceBase();
      const token = await serviceToken();
      const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000), redirect: "error" });
      const healthData = await health.json().catch(() => ({})) as { service?: string; executor?: string };
      if (!health.ok || healthData.service !== serviceName) throw new Error("本机 RunningHub H3 服务未就绪");
      if (healthData.executor !== "online") throw new Error("本机 RunningHub H3 执行器已暂停，请先在 H3 服务中恢复执行器");

      const resolution = request.resolution?.match(/^(0\.4|0\.6|0\.9)MP$/)?.[1];
      if (request.resolution && !resolution) throw new Error("RunningHub H3 分辨率仅支持 0.4MP、0.6MP 或 0.9MP");
      const parameters: Record<string, unknown> = {
        durationSeconds: request.duration ?? 10,
        aspectRatio: request.ratio || "16:9",
        ...(resolution ? { megapixels: Number(resolution) } : {}),
      };
      const preparedResponse = await callService(base, token, "/api/h3/prepare", {
        operationId: randomUUID(), prompt: request.prompt, references: await references(request), parameters,
      });
      const prepared = await preparedResponse.json() as { job?: { id?: string } };
      const jobId = prepared.job?.id;
      if (!jobId) throw new Error("RunningHub H3 未返回本地任务编号");
      if (signal?.aborted) {
        await callService(base, token, `/api/jobs/${encodeURIComponent(jobId)}/cancel`, {}, true);
        signal.throwIfAborted();
      }
      try {
        await callService(base, token, `/api/jobs/${encodeURIComponent(jobId)}/submit`, { confirmation: "submit" });
      } catch (error) {
        if (signal?.aborted) throw new Error(`已停止在导演台等待。H3 任务可能已进入本机队列，任务编号：${jobId}；请先查询它，不要再次点击生成。`);
        throw error;
      }

      const deadline = Date.now() + 15 * 60_000;
      try {
        while (Date.now() < deadline) {
          signal?.throwIfAborted();
          const response = await callService(base, token, `/api/jobs/${encodeURIComponent(jobId)}`);
          const result = await response.json() as { job?: { status?: string; outputs?: { url?: string | null; mimeType?: string | null }[]; error?: string } };
          const job = result.job;
          if (!job) throw new Error("本机 RunningHub H3 账本未返回任务状态");
          if (job.status === "succeeded") {
            const output = job.outputs?.[0];
            if (!output) throw new Error(`RunningHub H3 任务完成，但没有视频结果。任务编号：${jobId}`);
            if (output.url) return [{ mediaType: "video", type: "url", url: output.url, mimeType: output.mimeType ?? "video/mp4" }];
            const file = await callService(base, token, `/api/jobs/${encodeURIComponent(jobId)}/output/0`);
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (!bytes.length || bytes.length > maxOutputSize) throw new Error(`RunningHub H3 视频结果为空或超过 Toonflow 的 100MB 媒体限制。任务编号：${jobId}`);
            return [{ mediaType: "video", type: "binary", data: bytes, mimeType: file.headers.get("content-type")?.split(";")[0] || "video/mp4" }];
          }
          if (["failed", "cancelled"].includes(job.status ?? "")) throw new Error(job.error || `RunningHub H3 视频生成失败。任务编号：${jobId}`);
          if (job.status === "submission_unknown") throw new Error(`RunningHub 是否已接收任务尚未确认；请先在 RunningHub 核对原任务，不要重新生成。H3 任务编号：${jobId}`);
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 3000);
            signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
          });
        }
        throw new Error(`等待 RunningHub H3 视频超时；原任务仍保留在 H3 服务账本中，请查询原任务，不要重新提交。任务编号：${jobId}`);
      } catch (error) {
        if (signal?.aborted) throw new Error(`已停止在导演台等待。H3 任务仍由本机服务跟踪，任务编号：${jobId}；不要再次点击生成来替代它。`);
        throw error;
      }
    },
  };
}
