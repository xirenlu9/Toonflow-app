import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { existsSync } from "@toonflow/file";
import { dlopen, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

const execFileAsync = promisify(execFile);
const serviceName = "runninghub-minimax-h3-independent";
const credentialTarget = "Toonflow/RunningHubH3/Vault";

function credentialPassphrase() {
  const advapi32 = dlopen("advapi32.dll", {
    CredReadW: { args: ["ptr", "u32", "u32", "ptr"], returns: "i32" },
    CredWriteW: { args: ["ptr", "u32"], returns: "i32" },
    CredFree: { args: ["ptr"], returns: "void" },
  });
  const kernel32 = dlopen("kernel32.dll", { GetLastError: { args: [], returns: "u32" } });
  const api = advapi32.symbols;
  const target = Buffer.from(`${credentialTarget}\0`, "utf16le");
  const pointer = new BigUint64Array(1);

  try {
    if (!api.CredReadW(ptr(target), 1, 0, ptr(pointer))) {
      const errorCode = kernel32.symbols.GetLastError();
      if (errorCode !== 1168) throw new Error(`读取 Windows 凭据失败（${errorCode}）`);
      return null;
    }

    const credentialPointer = Number(pointer[0]) as Pointer;
    try {
      const credential = new DataView(toArrayBuffer(credentialPointer, 0, 80));
      const byteLength = credential.getUint32(32, true);
      const blobPointer = Number(credential.getBigUint64(40, true)) as Pointer;
      if (!byteLength || byteLength > 5120 || byteLength % 2 || !blobPointer) throw new Error("Windows 凭据中的 H3 Vault 口令无效");
      const passphrase = Buffer.from(toArrayBuffer(blobPointer, 0, byteLength)).toString("utf16le");
      if (passphrase.length < 12 || passphrase.includes("\0")) throw new Error("Windows 凭据中的 H3 Vault 口令无效");
      return passphrase;
    } finally {
      api.CredFree(credentialPointer);
    }
  } finally {
    kernel32.close();
    advapi32.close();
  }
}

function saveCredentialPassphrase(passphrase: string) {
  const advapi32 = dlopen("advapi32.dll", {
    CredWriteW: { args: ["ptr", "u32"], returns: "i32" },
  });
  const kernel32 = dlopen("kernel32.dll", { GetLastError: { args: [], returns: "u32" } });
  const target = Buffer.from(`${credentialTarget}\0`, "utf16le");
  const userName = Buffer.from("Toonflow\0", "utf16le");
  const secret = Buffer.from(passphrase, "utf16le");
  const credential = Buffer.alloc(80);
  const fields = new DataView(credential.buffer, credential.byteOffset, credential.byteLength);
  fields.setUint32(4, 1, true);
  fields.setBigUint64(8, BigInt(ptr(target)), true);
  fields.setUint32(32, secret.byteLength, true);
  fields.setBigUint64(40, BigInt(ptr(secret)), true);
  fields.setUint32(48, 2, true);
  fields.setBigUint64(72, BigInt(ptr(userName)), true);

  try {
    if (!advapi32.symbols.CredWriteW(ptr(credential), 0)) {
      throw new Error(`保存 Windows 凭据失败（${kernel32.symbols.GetLastError()}）`);
    }
  } finally {
    kernel32.close();
    advapi32.close();
  }
}

async function nodeExecutable() {
  const { stdout } = await execFileAsync("where.exe", ["node.exe"], { windowsHide: true });
  const executable = stdout.split(/\r?\n/).map(path => path.trim()).find(Boolean);
  if (!executable) throw new Error("未找到 Node.js；运行 H3 Skill 需要 Node.js 20 或更新版本");
  const versionResult = await execFileAsync(executable, ["--version"], { windowsHide: true });
  const majorVersion = versionResult.stdout.trim().match(/^v(\d+)\./)?.[1];
  if (!majorVersion || Number(majorVersion) < 20) throw new Error("运行 H3 Skill 需要 Node.js 20 或更新版本");
  return executable;
}

function resolveSkillDirectory() {
  const candidates = [
    process.env.RH_H3_SKILL_DIR,
    join(homedir(), ".codex", "skills", "runninghub-minimax-h3"),
    join(homedir(), ".agents", "skills", "runninghub-minimax-h3"),
  ].filter((path): path is string => Boolean(path));
  return candidates.find(path => existsSync(resolve(path, "service", "cli.mjs")));
}

function serviceConfiguration() {
  const base = new URL(process.env.RH_H3_BASE || `http://127.0.0.1:${process.env.RH_H3_PORT || "4317"}`);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
    throw new Error("RunningHub H3 仅支持本机 127.0.0.1 服务地址");
  }
  const port = Number(base.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("本机 H3 服务端口无效");
  process.env.RH_H3_BASE = base.origin;
  return { baseUrl: base.origin, port };
}

async function serviceOnline(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000), redirect: "error" });
    const health = await response.json() as { service?: string };
    return response.ok && health.service === serviceName;
  } catch {
    return false;
  }
}

async function startService() {
  if (process.platform !== "win32" || process.arch !== "x64") return;
  const { baseUrl, port } = serviceConfiguration();
  if (await serviceOnline(baseUrl)) return;

  const skillDirectory = resolveSkillDirectory();
  if (!skillDirectory) throw new Error("未找到 runninghub-minimax-h3 Skill；请安装该 Skill 后重新启动 Toonflow");
  const nodePath = await nodeExecutable();
  const serviceHome = resolve(process.env.RH_H3_HOME || join(homedir(), ".runninghub-h3-service"));
  process.env.RH_H3_HOME = serviceHome;
  let passphrase = credentialPassphrase();
  if (!passphrase) {
    if (existsSync(resolve(serviceHome, "state.json"))) {
      throw new Error("本机 H3 Vault 尚未关联 Windows 凭据，无法免口令自动解锁；现有 Vault 数据未修改");
    }
    passphrase = randomBytes(48).toString("base64url");
    saveCredentialPassphrase(passphrase);
  }

  const child = spawn(nodePath, [resolve(skillDirectory, "service", "cli.mjs"), "start"], {
    cwd: skillDirectory,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, RH_H3_HOME: serviceHome, RH_H3_PORT: String(port), RH_H3_VAULT_PASSPHRASE: passphrase },
  });
  let exitCode: number | null = null;
  child.once("exit", code => { exitCode = code; });
  child.once("error", error => console.error("启动本机 H3 服务进程失败：", error));
  child.unref();

  for (let attempt = 0; attempt < 30; attempt++) {
    if (await serviceOnline(baseUrl)) {
      console.info("本机 RunningHub H3 服务已随 Toonflow 启动");
      return;
    }
    if (exitCode !== null) throw new Error(`本机 H3 服务启动失败，进程退出码：${exitCode}`);
    await Bun.sleep(500);
  }
  throw new Error("本机 H3 服务启动超时；请确认 Skill 与 Node.js 安装正常");
}

let startupTask: Promise<void> | undefined;

export default function startRunningHubH3Service() {
  startupTask ??= startService().catch(error => {
    startupTask = undefined;
    throw error;
  });
  return startupTask;
}
