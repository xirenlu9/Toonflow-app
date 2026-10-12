import { createHash } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { runningHubH3ServiceRequest } from "@/utils/media/runningHubH3";

const serviceName = "runninghub-minimax-h3-independent";
const keySchema = z.object({
  apiKey: z.string().regex(/^[a-fA-F0-9]{32}$/),
  accountGroup: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
}).strict();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function publicKey(value: unknown) {
  const key = record(value);
  const account = record(key.accountStatus);
  return {
    keyId: typeof key.keyId === "string" ? key.keyId : "",
    accountGroup: typeof key.accountGroup === "string" ? key.accountGroup : "",
    enabled: key.enabled === true,
    consumerStatus: typeof key.consumerStatus === "string" ? key.consumerStatus : "unverified",
    accountStatus: key.accountStatus ? {
      remainCoins: finiteNumber(account.remainCoins),
      remainMoney: finiteNumber(account.remainMoney),
      currency: typeof account.currency === "string" ? account.currency : null,
      currentTaskCount: finiteNumber(account.currentTaskCount),
      checkedAt: typeof key.checkedAt === "string" ? key.checkedAt : null,
    } : null,
    createdAt: typeof key.createdAt === "string" ? key.createdAt : null,
    lastUsedAt: typeof key.lastUsedAt === "number" ? key.lastUsedAt : null,
    availableAfter: typeof key.availableAfter === "number" ? key.availableAfter : null,
  };
}

function publicJob(value: unknown) {
  const job = record(value);
  const rawUsage = record(job.usage);
  const rawParameters = record(job.parameters);
  return {
    id: typeof job.id === "string" ? job.id : "",
    status: typeof job.status === "string" ? job.status : "unknown",
    taskId: typeof job.taskId === "string" ? job.taskId : null,
    keyId: typeof job.keyId === "string" ? job.keyId : null,
    accountGroup: typeof job.accountGroup === "string" ? job.accountGroup : null,
    parameters: {
      durationSeconds: finiteNumber(rawParameters.durationSeconds),
      aspectRatio: typeof rawParameters.aspectRatio === "string" ? rawParameters.aspectRatio : null,
      megapixels: finiteNumber(rawParameters.megapixels),
    },
    usage: {
      rhCoins: finiteNumber(rawUsage.rhCoins),
      walletAmount: finiteNumber(rawUsage.walletAmount),
      thirdPartyAmount: finiteNumber(rawUsage.thirdPartyAmount),
      currency: typeof rawUsage.currency === "string" ? rawUsage.currency : null,
    },
    waitReason: typeof job.waitReason === "string" ? job.waitReason : null,
    hasError: typeof job.error === "string" && job.error.length > 0,
    createdAt: typeof job.createdAt === "string" ? job.createdAt : null,
    updatedAt: typeof job.updatedAt === "string" ? job.updatedAt : null,
  };
}

function localDesktopOnly(req: Request, _res: Response, next: NextFunction) {
  const address = req.socket.remoteAddress ?? "";
  const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
  const localHost = req.hostname.toLowerCase() === "127.0.0.1";
  const requestOrigin = `http://${req.get("host")}`;
  const origin = req.get("origin");
  const referer = req.get("referer");
  const sameOrigin = origin !== undefined
    ? origin === requestOrigin
    : !!referer && referer.startsWith(`${requestOrigin}/`);
  if (!req.app.locals.desktop || !localAddress || !localHost || req.get("x-toonflow-desktop") !== "1" || !sameOrigin || u.mobileLink.isMobileLinkRequest(req)) {
    next(Object.assign(new Error("H3 Key 池只允许本机 Toonflow 桌面端管理"), { status: 403 }));
    return;
  }
  next();
}

const router = Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store").set("Pragma", "no-cache");
  next();
});
router.use(localDesktopOnly);

router.get("/overview", async (_req, res) => {
  const health = await runningHubH3ServiceRequest("/api/health");
  if (health.service !== serviceName) throw Object.assign(new Error("连接的本机服务不是 RunningHub H3 服务"), { status: 503 });
  const [executorResponse, keyResponse, jobResponse] = await Promise.all([
    runningHubH3ServiceRequest("/api/executor").catch((error: unknown) => {
      if (error && typeof error === "object" && "status" in error && error.status === 404) return null;
      throw error;
    }),
    runningHubH3ServiceRequest("/api/keys"),
    runningHubH3ServiceRequest("/api/jobs"),
  ]);
  const keys = Array.isArray(keyResponse.keys) ? keyResponse.keys.map(publicKey) : [];
  const allJobs = Array.isArray(jobResponse.jobs) ? jobResponse.jobs : [];
  const jobs = allJobs.slice(-100).reverse().map(publicJob);
  const activeTasks = allJobs.filter(job => ["uploading", "submitting", "submission_unknown", "submitted", "remote_queued", "running"].includes(record(job).status as string)).length;
  const executor = record(executorResponse);
  const canControl = executorResponse !== null;
  const executorStatus = typeof health.executor === "string" ? health.executor : "unknown";
  res.json(success({
    service: { online: health.ok === true, executor: executorStatus },
    executor: {
      paused: canControl ? executor.paused === true : executorStatus === "paused",
      reason: typeof executor.reason === "string" ? executor.reason : null,
      storageBlocked: executor.storageBlocked === true || executorStatus === "blocked",
      canControl,
      activeTasks: finiteNumber(health.activeTasks) ?? activeTasks,
    },
    settings: {
      maxConcurrent: canControl ? finiteNumber(record(executor.settings).maxConcurrent) : null,
      minCredits: canControl ? finiteNumber(record(executor.settings).minCredits) : null,
    },
    keys,
    jobs,
  }));
});

router.get("/jobs", async (_req, res) => {
  const response = await runningHubH3ServiceRequest("/api/jobs");
  const jobs = Array.isArray(response.jobs) ? response.jobs.slice(-100).reverse().map(publicJob) : [];
  res.json(success(jobs));
});

async function importItems(items: z.infer<typeof keySchema>[]) {
  const existingResponse = await runningHubH3ServiceRequest("/api/keys");
  const existingKeys = Array.isArray(existingResponse.keys) ? existingResponse.keys.map(record) : [];
  const fingerprints = new Map<string, string>();
  for (const key of existingKeys) {
    if (typeof key.fingerprint === "string" && typeof key.accountGroup === "string") fingerprints.set(key.fingerprint, key.accountGroup);
  }

  let added = 0;
  let existing = 0;
  const failed: { index: number; reason: string }[] = [];
  for (const [index, item] of items.entries()) {
    const fingerprint = createHash("sha256").update(item.apiKey).digest("hex");
    const group = fingerprints.get(fingerprint);
    if (group !== undefined) {
      if (group === item.accountGroup) existing++;
      else failed.push({ index, reason: "此 Key 已绑定到其他匿名账号组，未覆盖" });
      continue;
    }
    try {
      await runningHubH3ServiceRequest("/api/keys", "POST", item);
      fingerprints.set(fingerprint, item.accountGroup);
      added++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "导入失败";
      failed.push({ index, reason: message.slice(0, 200) });
    }
  }
  return { added, existing, failed };
}

router.post("/keys", async (req, res) => {
  const parsed = keySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(error("Key 格式或账号组无效"));
  const result = await importItems([parsed.data]);
  const failure = result.failed[0];
  if (failure) return res.status(409).json(error(failure.reason, null, 409));
  res.json(success({ added: result.added, existing: result.existing }));
});

router.post("/keys/import", async (req, res) => {
  const body = z.object({ items: z.array(keySchema).min(1).max(100) }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json(error("导入数据无效或超过 100 条"));
  res.json(success(await importItems(body.data.items)));
});

router.post("/keys/:keyId/probe", async (req, res) => {
  if (!/^rhkey_[a-f0-9-]{36}$/i.test(req.params.keyId ?? "")) return res.status(400).json(error("Key 编号无效"));
  const result = await runningHubH3ServiceRequest(`/api/keys/${encodeURIComponent(req.params.keyId)}/probe`, "POST", {});
  res.json(success(publicKey(record(result).key)));
});

router.patch("/keys/:keyId", async (req, res) => {
  if (!/^rhkey_[a-f0-9-]{36}$/i.test(req.params.keyId ?? "")) return res.status(400).json(error("Key 编号无效"));
  const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json(error("启用状态无效"));
  const result = await runningHubH3ServiceRequest(`/api/keys/${encodeURIComponent(req.params.keyId)}`, "PATCH", body.data);
  res.json(success(publicKey(record(result).key)));
});

router.patch("/settings", async (req, res) => {
  const body = z.object({
    maxConcurrent: z.number().int().min(1).max(4).optional(),
    minCredits: z.number().finite().gt(0).max(1e12).optional(),
  }).strict().refine(value => Object.keys(value).length > 0).safeParse(req.body);
  if (!body.success) return res.status(400).json(error("并发数或最低积分设置无效"));
  const result = await runningHubH3ServiceRequest("/api/settings", "PATCH", body.data);
  res.json(success(result));
});

router.post("/executor/pause", async (_req, res) => {
  const result = await runningHubH3ServiceRequest("/api/executor/pause", "POST", {});
  res.json(success(result));
});

router.post("/executor/resume", async (_req, res) => {
  const result = await runningHubH3ServiceRequest("/api/executor/resume", "POST", {});
  res.json(success(result));
});

export default router;
