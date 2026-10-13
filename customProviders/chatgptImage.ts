type ImageRequest = {
  model: string;
  prompt: string;
  images?: unknown[];
  mask?: unknown;
  n?: number;
  ratio?: string;
  size?: string;
  quality?: string;
};

type ProviderContext = {
  config: { apiUrl?: string; apiKey?: string };
  signal?: AbortSignal;
  tool: { fetch: typeof fetch; errorMessage(value: unknown): string };
};

const rules = [
  {
    type: "input",
    field: "apiUrl",
    title: "Base URL（包含 /v1）",
    value: "http://124.220.13.249:3010/v1",
    props: { autocomplete: "off" },
  },
  {
    type: "input",
    field: "apiKey",
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

// 按服务自身 Studio 页面的一档尺寸映射，不宣称支持未启用的 2K/4K。
const imageSizes: Record<string, string> = {
  "1:1": "1024x1024",
  "2:3": "1024x1536",
  "3:2": "1536x1024",
  "3:4": "1024x1365",
  "4:3": "1365x1024",
  "9:16": "1088x1920",
  "16:9": "1920x1088",
};

function imageAsset(item: Record<string, unknown>) {
  if (typeof item.b64_json === "string" && item.b64_json.trim()) {
    const data = item.b64_json.replace(/^data:image\/[^;,]+;base64,/i, "").replace(/\s/g, "");
    if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1) throw new Error("图片服务返回了无效的 Base64 数据");
    const bytes = Buffer.from(data, "base64");
    const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "";
    if (!mimeType) throw new Error("图片服务未返回可识别的 PNG、JPEG 或 WebP 图片");
    return { mediaType: "image" as const, type: "base64" as const, data, mimeType };
  }
  if (typeof item.url === "string") {
    const url = new URL(item.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("图片服务返回的图片地址无效");
    return { mediaType: "image" as const, type: "url" as const, url: url.toString() };
  }
  throw new Error("图片服务未返回图片数据");
}

export default {
  id: "chatgptImage",
  label: "ChatGPT2API 图片（自定义）",
  version: "1.0.0",
  readme: "通过自定义 OpenAI 兼容网关生成图片。当前仅启用文生图；图片编辑、参考图及 2K/4K 未启用。模型名称由网关提供。API Key 只在本机连接配置中填写，不在供应商文件中保存。当前地址使用 HTTP，正式使用建议改为 HTTPS。",
  rules,
  models: [
    { id: "gpt-image-2", label: "GPT Image 2", type: "image", mode: ["text"], imageSizes: ["1K"], imageRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] },
    { id: "gpt-image-2.5", label: "GPT Image 2.5", type: "image", mode: ["text"], imageSizes: ["1K"], imageRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] },
    { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", type: "image", mode: ["text"], imageSizes: ["1K"], imageRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] },
    { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", type: "image", mode: ["text"], imageSizes: ["1K"], imageRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] },
  ],
  async generateImage(this: ProviderContext, request: ImageRequest) {
    if (request.images?.length || request.mask) throw new Error("此供应商当前仅支持文生图，请移除参考图或使用支持图片编辑的供应商");
    if (!request.prompt?.trim()) throw new Error("请输入图片提示词");
    if (request.size && request.size !== "1K") throw new Error("此供应商当前只启用 1K 尺寸档位");
    const size = imageSizes[request.ratio ?? "16:9"];
    if (!size) throw new Error("此供应商不支持所选图片比例");
    const n = request.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("生成数量须为 1 到 4");
    const apiKey = (this.config.apiKey ?? "").trim().replace(/^Bearer\s+/i, "").trim();
    if (!apiKey) throw new Error("请在媒体模型中填写此图片供应商的 API Key");
    const apiUrl = new URL((this.config.apiUrl ?? "").trim());
    if (!["http:", "https:"].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) throw new Error("Base URL 必须是不含凭据、查询参数或锚点的 HTTP(S) 地址");
    const signal = AbortSignal.any([AbortSignal.timeout(24 * 60_000), ...(this.signal ? [this.signal] : [])]);
    signal.throwIfAborted();
    // 生成请求只提交一次；网络失败不自动重试，以免重复消耗额度。
    const response = await this.tool.fetch(`${apiUrl.toString().replace(/\/+$/, "")}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: request.model, prompt: request.prompt, n, size, quality: request.quality ?? "auto", response_format: "b64_json", history_disabled: true, stream: false }),
      signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`图片生成请求失败（HTTP ${response.status}）`);
    const result = await response.json() as { error?: unknown; data?: unknown };
    if (result.error) throw new Error(this.tool.errorMessage(result.error) || "图片服务生成失败");
    if (!Array.isArray(result.data) || !result.data.length || result.data.length > 4) throw new Error("图片服务未返回有效的图片结果");
    return result.data.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("图片服务结果格式错误");
      return imageAsset(item as Record<string, unknown>);
    });
  },
};
