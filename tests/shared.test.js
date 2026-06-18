import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkCircuitBreaker,
  checkRateLimit,
  fetchWithRetry,
  getChannelPerformance,
  getPerformanceWindow,
  getPerformanceWindows,
  handleAdminRequest,
  handleChatCompletions,
  getUserUsageStats,
  listChannels,
  recordPerformance,
  recordUsage
} from "../lib/shared.js";
import { createMockKv } from "./helpers/kv.js";

describe("checkCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns closed when no breaker state exists", async () => {
    const kv = createMockKv();

    await expect(checkCircuitBreaker(kv, "breaker:openai")).resolves.toBe("closed");
  });

  it("keeps an open breaker open before timeout", async () => {
    const now = Date.now();
    const kv = createMockKv({
      "breaker:openai": { state: "open", failures: 5, openedAt: now - 59_000 }
    });

    await expect(checkCircuitBreaker(kv, "breaker:openai")).resolves.toBe("open");
  });

  it("moves an expired open breaker into half_open", async () => {
    const now = Date.now();
    const kv = createMockKv({
      "breaker:openai": { state: "open", failures: 5, openedAt: now - 60_000 }
    });

    await expect(checkCircuitBreaker(kv, "breaker:openai")).resolves.toBe("half_open");

    const stored = JSON.parse(kv.dump()["breaker:openai"]);
    expect(stored).toMatchObject({
      state: "half_open",
      failures: 0,
      openedAt: now - 60_000,
      halfOpenAt: now,
      halfOpenRequests: 0
    });
    expect(kv.puts.at(-1).options).toEqual({ expirationTtl: 300 });
  });

  it("allows only the configured half-open probe request", async () => {
    const kv = createMockKv({
      "breaker:openai": { state: "half_open", failures: 0, halfOpenRequests: 0 }
    });

    await expect(checkCircuitBreaker(kv, "breaker:openai")).resolves.toBe("half_open");
    await expect(checkCircuitBreaker(kv, "breaker:openai")).resolves.toBe("open");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:01:15.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments user and IP counters when request is under limits", async () => {
    const kv = createMockKv();
    const request = new Request("https://example.test/v1/chat/completions", {
      headers: { "cf-connecting-ip": "203.0.113.9" }
    });

    await expect(checkRateLimit(kv, request, { id: "user-1", rate_limit: 3 })).resolves.toBeNull();

    const windowStart = Math.floor(Date.now() / 60_000);
    expect(kv.dump()[`ratelimit:user:user-1:${windowStart}`]).toBe("1");
    expect(kv.dump()[`ratelimit:ip:203.0.113.9:${windowStart}`]).toBe("1");
    expect(kv.puts).toEqual([
      {
        key: `ratelimit:user:user-1:${windowStart}`,
        value: "1",
        options: { expirationTtl: 120 }
      },
      {
        key: `ratelimit:ip:203.0.113.9:${windowStart}`,
        value: "1",
        options: { expirationTtl: 120 }
      }
    ]);
  });

  it("returns a user-scoped 429 response with rate limit metadata", async () => {
    const windowStart = Math.floor(Date.now() / 60_000);
    const resetAt = windowStart * 60_000 + 60_000;
    const kv = createMockKv({
      [`ratelimit:user:user-1:${windowStart}`]: "2",
      [`ratelimit:ip:203.0.113.9:${windowStart}`]: "0"
    });
    const request = new Request("https://example.test/v1/chat/completions", {
      headers: { "cf-connecting-ip": "203.0.113.9" }
    });

    const response = await checkRateLimit(kv, request, { id: "user-1", rate_limit: 2 });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(String(resetAt));
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(body.error).toMatchObject({
      code: "rate_limit_exceeded",
      scope: "user",
      limit: 2,
      remaining: 0,
      reset_at: resetAt,
      retry_after: 60
    });
    expect(kv.puts).toHaveLength(0);
  });

  it("returns an IP-scoped 429 response after user limit passes", async () => {
    const windowStart = Math.floor(Date.now() / 60_000);
    const kv = createMockKv({
      [`ratelimit:user:user-1:${windowStart}`]: "0",
      [`ratelimit:ip:198.51.100.10:${windowStart}`]: "120"
    });
    const request = new Request("https://example.test/v1/chat/completions", {
      headers: { "x-forwarded-for": "198.51.100.10" }
    });

    const response = await checkRateLimit(kv, request, { id: "user-1", rate_limit: 10 });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(body.error).toMatchObject({
      code: "rate_limit_exceeded",
      scope: "ip",
      limit: 120
    });
    expect(kv.puts).toHaveLength(0);
  });
});

describe("usage statistics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:02:03.456Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records usage under the daily user prefix", async () => {
    const kv = createMockKv();

    await recordUsage(kv, "user-1", "channel-1", "gpt-4o-mini", {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18
    });

    const key = "usage:user-1:2026-06-09:1780999323456";
    expect(JSON.parse(kv.dump()[key])).toEqual({
      userId: "user-1",
      channelId: "channel-1",
      model: "gpt-4o-mini",
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
      timestamp: 1780999323456
    });
    expect(kv.puts[0].options).toEqual({ expirationTtl: 86400 * 30 });
  });

  it("aggregates usage stats by model and estimates cost", async () => {
    const kv = createMockKv({
      "usage:user-1:2026-06-09:1": {
        userId: "user-1",
        model: "gpt-4o-mini",
        totalTokens: 1000
      },
      "usage:user-1:2026-06-09:2": {
        userId: "user-1",
        model: "gpt-4o",
        totalTokens: 2000
      },
      "usage:other-user:2026-06-09:1": {
        userId: "other-user",
        model: "gpt-4o-mini",
        totalTokens: 9999
      }
    });

    const stats = await getUserUsageStats(kv, "user-1");

    expect(stats).toEqual({
      totalRequests: 2,
      totalTokens: 3000,
      totalCost: 0.0129,
      byModel: {
        "gpt-4o-mini": { requests: 1, tokens: 1000 },
        "gpt-4o": { requests: 1, tokens: 2000 }
      }
    });
  });
});

describe("admin KV listing", () => {
  it("reads listed JSON values in parallel across paged KV list results", async () => {
    const kv = createMockKv(
      Object.fromEntries(
        Array.from({ length: 105 }, (_, index) => {
          const id = `ch-${String(index).padStart(3, "0")}`;
          return [
            `channel_${id}`,
            {
              id,
              name: `Channel ${String(index).padStart(3, "0")}`,
              type: "openai",
              base_url: "https://api.example.test/v1",
              api_key: `secret-${index}`,
              enabled: true,
              weight: index
            }
          ];
        })
      )
    );
    const originalGet = kv.get;
    const pendingGets = new Set();
    let maxPendingGets = 0;

    kv.get = async (...args) => {
      const pending = originalGet(...args);
      pendingGets.add(pending);
      maxPendingGets = Math.max(maxPendingGets, pendingGets.size);
      try {
        return await pending;
      } finally {
        pendingGets.delete(pending);
      }
    };

    const channels = await listChannels(kv);

    expect(channels).toHaveLength(105);
    expect(channels[0]).not.toHaveProperty("api_key");
    expect(maxPendingGets).toBeGreaterThan(1);
  });
});

describe("performance monitoring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T10:15:30.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes current and recent performance windows from one helper", () => {
    const now = Date.now();
    const currentWindow = Math.floor(now / 300_000);

    expect(getPerformanceWindow(now)).toBe(currentWindow);
    expect(getPerformanceWindows(now, 3)).toEqual([
      currentWindow,
      currentWindow - 1,
      currentWindow - 2
    ]);
  });

  it("records and aggregates performance data for the recent windows", async () => {
    const kv = createMockKv();

    await recordPerformance(kv, "channel-1", "gpt-4o-mini", 100, true);
    await recordPerformance(kv, "channel-1", "gpt-4o-mini", 300, false);

    vi.setSystemTime(new Date(Date.now() + 300_000));
    await recordPerformance(kv, "channel-1", "gpt-4o-mini", 200, true);

    const performance = await getChannelPerformance(kv, "channel-1", "gpt-4o-mini");

    expect(performance).toEqual({
      channelId: "channel-1",
      model: "gpt-4o-mini",
      totalRequests: 3,
      successRequests: 2,
      failedRequests: 1,
      avgDuration: 200,
      minDuration: 100,
      maxDuration: 300,
      successRate: 67
    });
  });
});

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries retriable HTTP responses and returns the first success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://upstream.test", {}, { retries: 1, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(250);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retriable HTTP responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://upstream.test", {}, { retries: 3, timeoutMs: 1000 });

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wraps network failures and retries until exhausted", async () => {
    const networkError = new Error("connection refused");
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithRetry("https://upstream.test", {}, { retries: 1, timeoutMs: 1000 }).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(250);

    const error = await promise;
    expect(error.name).toBe("UpstreamNetworkError");
    expect(error.message).toBe("connection refused");
    expect(error.cause).toBe(networkError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("channel model sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("syncs upstream models into channel mappings and routes chat by channel-specific upstream model", async () => {
    const kv = createMockKv({
      "channel_ch_openai": {
        id: "ch_openai",
        name: "OpenAI",
        type: "openai",
        base_url: "https://openai.example/v1",
        api_key: "sk-openai",
        enabled: true,
        weight: 10
      },
      "channel_ch_gemini": {
        id: "ch_gemini",
        name: "Gemini",
        type: "gemini",
        base_url: "https://gemini.example/v1beta",
        api_key: "gem-key",
        enabled: true,
        weight: 1
      },
      "user_usr_1": {
        id: "usr_1",
        name: "demo",
        key_hash: "aa",
        api_key: "sk-demo",
        allowed_models: [],
        is_default: false,
        enabled: true,
        created_at: "2026-06-18T07:00:00.000Z",
        updated_at: "2026-06-18T07:00:00.000Z"
      },
      "userkey_aa": "usr_1",
      "model_6770742d346f": {
        model: "gpt-4o",
        upstream_model: "gpt-4o",
        channel_ids: ["ch_openai"],
        channel_mappings: {
          ch_openai: "gpt-4o"
        },
        updated_at: "2026-06-18T07:00:00.000Z"
      }
    });

    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url) === "https://gemini.example/v1beta/models") {
        return new Response(JSON.stringify({
          models: [
            { name: "models/gemini-2.5-pro" },
            { name: "models/gemini-2.5-flash" }
          ]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (String(url) === "https://gemini.example/v1beta/models/gemini-2.5-pro:generateContent") {
        return new Response(JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "ok" }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: JSON.parse(options.body).model,
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      getRandomValues: (array) => {
        array.fill(1);
        return array;
      },
      subtle: {
        digest: vi.fn(async (_algorithm, data) => {
          const text = new TextDecoder().decode(data);
          if (text === "sk-demo") {
            return Uint8Array.from([0xaa]).buffer;
          }
          throw new Error(`Unexpected digest input: ${text}`);
        }),
        importKey: vi.fn(),
        sign: vi.fn()
      }
    });

    const syncResponse = await handleAdminRequest({
      request: new Request("https://example.test/api/admin/models/sync", {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel_id: "ch_gemini",
          model_ids: ["gpt-4o", "gemini-2.5-pro"]
        })
      }),
      env: {
        AIAPI_KV: kv,
        ADMIN_TOKEN: "admin-secret"
      }
    });

    expect(syncResponse.status).toBe(200);
    const syncBody = await syncResponse.json();
    expect(syncBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        model: "gpt-4o",
        channel_ids: expect.arrayContaining(["ch_openai", "ch_gemini"]),
        channel_mappings: expect.objectContaining({
          ch_openai: "gpt-4o",
          ch_gemini: "gpt-4o"
        })
      }),
      expect.objectContaining({
        model: "gemini-2.5-pro",
        channel_ids: ["ch_gemini"],
        channel_mappings: {
          ch_gemini: "gemini-2.5-pro"
        }
      })
    ]));

    const fetchResponse = await handleAdminRequest({
      request: new Request("https://example.test/api/admin/models/fetch", {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel: {
            id: "ch_gemini",
            name: "Gemini",
            type: "gemini",
            base_url: "https://gemini.example/v1beta",
            api_key: "gem-key",
            enabled: true,
            weight: 1
          }
        })
      }),
      env: {
        AIAPI_KV: kv,
        ADMIN_TOKEN: "admin-secret"
      }
    });

    expect(fetchResponse.status).toBe(200);
    const fetchBody = await fetchResponse.json();
    expect(fetchBody.data).toEqual([
      { id: "gemini-2.5-flash", channel_id: "ch_gemini", channel_name: "Gemini" },
      { id: "gemini-2.5-pro", channel_id: "ch_gemini", channel_name: "Gemini" }
    ]);

    const chatResponse = await handleChatCompletions({
      request: new Request("https://example.test/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-demo",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "hello" }]
        })
      }),
      env: {
        AIAPI_KV: kv
      },
      waitUntil: vi.fn()
    });

    expect(chatResponse.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gemini.example/v1beta/models/gemini-2.5-pro:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": "gem-key"
        })
      })
    );
  });
});
