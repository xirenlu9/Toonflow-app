import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchProviderModels } from "./models.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("preserves context and output limits from OpenAI-compatible model catalogs", async () => {
  globalThis.fetch = async () => Response.json({
    data: [{
      id: "global:deepseek-v4.1-flash",
      context_length: 1_000_000,
      max_output_tokens: 128_000,
    }],
  });

  const models = await fetchProviderModels({
    apiUrl: "http://127.0.0.1:7863/v1",
    protocol: "openai-completions",
    apiKey: "local-test-key",
  });

  assert.deepEqual(models, [{
    id: "global:deepseek-v4.1-flash",
    label: "global:deepseek-v4.1-flash",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
  }]);
});
