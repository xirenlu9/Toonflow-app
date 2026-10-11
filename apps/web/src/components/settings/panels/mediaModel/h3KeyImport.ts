export type H3ImportedKey = { line: number; apiKey: string; accountGroup: string };
export type H3ImportFailure = { line: number; reason: string };
export type H3ImportPreview = {
  entries: H3ImportedKey[];
  failures: H3ImportFailure[];
  duplicateCount: number;
  accountGroupCount: number;
};

const maxTextBytes = 1024 * 1024;
const maxKeys = 100;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function accountGroupFor(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `acct_${hex.slice(0, 24)}`;
}

/** Parse the legacy five-column export locally; only the consumer API key and anonymous group leave the renderer. */
export async function parseH3KeyImport(source: string): Promise<H3ImportPreview> {
  if (new TextEncoder().encode(source).byteLength > maxTextBytes) {
    throw new Error("TXT 文件超过 1 MB，未读取导入内容");
  }
  const entries: H3ImportedKey[] = [];
  const failures: H3ImportFailure[] = [];
  const seen = new Map<string, string>();
  let duplicateCount = 0;
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);

  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    if (!rawLine.trim()) continue;
    const fields = rawLine.split("----");
    if (fields.length !== 5) {
      failures.push({ line, reason: "必须恰好包含 5 个字段" });
      continue;
    }
    const [rawEmail, _loginPassword, rawCredits, rawKey] = fields;
    const email = rawEmail.trim();
    const credits = rawCredits.trim();
    const apiKey = rawKey.trim().toLowerCase();
    if (!emailPattern.test(email)) {
      failures.push({ line, reason: "邮箱格式无效" });
      continue;
    }
    if (!/^\d+(?:\.\d+)?$/.test(credits) || !Number.isFinite(Number(credits))) {
      failures.push({ line, reason: "旧积分字段格式无效" });
      continue;
    }
    if (!/^[a-f0-9]{32}$/.test(apiKey)) {
      failures.push({ line, reason: "消费级 Key 必须为 32 位十六进制" });
      continue;
    }

    const accountGroup = await accountGroupFor(email);
    const priorGroup = seen.get(apiKey);
    if (priorGroup !== undefined) {
      if (priorGroup !== accountGroup) failures.push({ line, reason: "重复 Key 对应不同账号组，未导入" });
      else duplicateCount++;
      continue;
    }
    seen.set(apiKey, accountGroup);
    if (entries.length >= maxKeys) {
      failures.push({ line, reason: "单次最多导入 100 个不同 Key" });
      continue;
    }
    entries.push({ line, apiKey, accountGroup });
  }

  return {
    entries,
    failures,
    duplicateCount,
    accountGroupCount: new Set(entries.map(entry => entry.accountGroup)).size,
  };
}
