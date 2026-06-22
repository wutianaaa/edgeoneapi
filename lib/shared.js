const KV_BINDING = "AIAPI_KV";
const DEFAULT_USER_KEY = "default_user";

/* v8 ignore start */
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

// Rate limiting configuration (requests per minute)
const DEFAULT_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const HEALTH_RATE_LIMIT_PER_MIN = 20;
const ADMIN_SESSION_COOKIE = "aiapi_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const ANTHROPIC_VERSION = "2023-06-01";
const CHANNEL_TYPES = new Set(["openai", "anthropic", "gemini"]);
const NO_CHANNEL_ID = "__aiapi_no_channels__";
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60000;
const DEFAULT_UPSTREAM_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 250;
const kvDebugContexts = new WeakMap();

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5; // 连续失败次数
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 熔断时间 60 秒
const CIRCUIT_BREAKER_HALF_OPEN_REQUESTS = 1; // 半开状态允许的请求数

// Performance monitoring
const PERFORMANCE_WINDOW = 300000; // 5 分钟窗口

class UserInputError extends Error {}
class UpstreamTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Upstream request timed out after ${timeoutMs}ms.`);
    this.name = "UpstreamTimeoutError";
  }
}

class UpstreamNetworkError extends Error {
  constructor(cause) {
    super(cause?.message || "Upstream network request failed.");
    this.name = "UpstreamNetworkError";
    this.cause = cause;
  }
}

async function _handleAdminRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return noContent();
  }

  if (url.pathname === "/api/health") {
    const kv = getKv(context.env);
    const clientIP = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS);
    const healthKey = `ratelimit:health:${clientIP}:${windowStart}`;

    const countStr = await kv.get(healthKey);
    const count = parseInt(countStr || "0");

    if (count >= HEALTH_RATE_LIMIT_PER_MIN) {
      const resetAt = windowStart * RATE_LIMIT_WINDOW_MS + RATE_LIMIT_WINDOW_MS;
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      return errorWithHeaders(429, "rate_limit_exceeded", "Health endpoint rate limit exceeded.", {
        "X-RateLimit-Limit": String(HEALTH_RATE_LIMIT_PER_MIN),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetAt),
        "Retry-After": String(retryAfter)
      }, {
        limit: HEALTH_RATE_LIMIT_PER_MIN,
        remaining: 0,
        reset: Math.floor(resetAt / 1000),
        retry_after: retryAfter
      });
    }

    await kv.put(healthKey, String(count + 1), { expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 10 });
    return json({ ok: true });
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] === "api" && segments[1] === "admin" && segments[2] === "session") {
    return await handleAdminSession(context);
  }

  const adminError = await validateAdmin(request, context.env);
  if (adminError) return adminError;

  if (segments[0] !== "api" || segments[1] !== "admin") {
    return error(404, "not_found", "Route not found.");
  }

  const resource = segments[2];
  const id = decodeURIComponent(segments.slice(3).join("/"));

  try {
    if (resource === "channels") {
      return await handleChannels(context, id);
    }
    if (resource === "models") {
      return await handleModels(context, id);
    }
    if (resource === "users") {
      return await handleUsers(context, id);
    }
    if (resource === "health") {
      return await handleHealthCheck(context);
    }
    if (resource === "performance") {
      return await handlePerformanceStats(context);
    }
    if (resource === "usage") {
      return await handleUsageStats(context);
    }
    if (resource === "logs") {
      return await handleRequestLogs(context);
    }
    return error(404, "not_found", "Admin resource not found.");
  } catch (cause) {
    if (cause instanceof UserInputError) {
      return error(400, "invalid_request_error", cause.message);
    }
    return error(500, "internal_error", cause.message || "Internal server error.");
  }
}

async function _handleChatCompletions(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return noContent();
  }
  if (request.method !== "POST") {
    return error(405, "method_not_allowed", "Only POST is supported.");
  }

  const auth = await authenticateUser(context);
  if (auth.error) return auth.error;

  // 速率限制检查
  const kv = getKv(context.env);
  const rateLimitError = await checkRateLimit(kv, request, auth.user);
  if (rateLimitError) return rateLimitError;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return error(400, "invalid_request_error", "Request body must be valid JSON.");
  }

  if (!payload || typeof payload !== "object" || !payload.model || !Array.isArray(payload.messages)) {
    return error(400, "invalid_request_error", "Body must include model and messages.");
  }

  const accessError = validateModelAccess(auth.user, payload.model);
  if (accessError) return accessError;

  // 并行获取模型映射和渠道列表（减少延迟）
  const [mapping, channels] = await Promise.all([
    getJson(kv, modelKey(payload.model)),
    listChannels(kv, { exposeSecrets: true })
  ]);

  const candidates = selectCandidates(channels, mapping);

  if (!candidates.length) {
    return error(503, "no_available_channel", `No enabled channel is available for model ${payload.model}.`);
  }

  const failures = [];
  const startRequestTime = Date.now();
  const clientIP = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const upstreamOptions = getUpstreamOptions(context.env);

  for (const channel of candidates) {
    // 检查熔断器状态
    const breakerKey = `breaker:${channel.id}:${payload.model}`;
    const breakerState = await checkCircuitBreaker(kv, breakerKey);

    if (breakerState === "open") {
      failures.push({
        channel: channel.name || channel.id,
        status: "circuit_open",
        body: "Circuit breaker is open, skipping this channel"
      });
      continue;
    }

    const upstreamPayload = {
      ...payload,
      model: resolveUpstreamModelForChannel(mapping, channel.id, payload.model)
    };
    if (payload.stream) {
      upstreamPayload.stream_options = {
        ...(payload.stream_options || {}),
        include_usage: true
      };
    }

    const startTime = Date.now();
    let response;
    try {
      response = await fetchUpstream(channel, upstreamPayload, request, upstreamOptions);
    } catch (cause) {
      const duration = Date.now() - startTime;
      await Promise.all([
        recordPerformance(kv, channel.id, payload.model, duration, false),
        recordFailure(kv, breakerKey)
      ]);
      failures.push({
        channel: channel.name || channel.id,
        status: cause instanceof UpstreamTimeoutError ? "timeout" : "network_error",
        body: cause.message || "Upstream request failed."
      });
      continue;
    }
    const duration = Date.now() - startTime;

    if (response.ok) {
      // 异步记录性能和熔断器（不阻塞响应）
      const recordPromises = [
        recordPerformance(kv, channel.id, payload.model, duration, response.ok),
        resetCircuitBreaker(kv, breakerKey),
        logRequest(kv, {
          userId: auth.user.id,
          model: payload.model,
          status: response.status,
          duration: Date.now() - startRequestTime,
          ip: clientIP
        })
      ];

      // 如果不是流式响应，记录使用统计
      if (!payload.stream) {
        recordPromises.push((async () => {
          try {
            const clonedResponse = response.clone();
            const body = await clonedResponse.json();
            if (body.usage) {
              await recordUsage(kv, auth.user.id, channel.id, payload.model, body.usage);
            }
          } catch {
            // 忽略解析错误
          }
        })());
      }

      // 在后台执行记录，不等待完成
      safeWaitUntil(context, Promise.all(recordPromises));

      return proxyUpstreamResponse(response, {
        onUsage: (usage) => safeWaitUntil(context, recordUsage(kv, auth.user.id, channel.id, payload.model, usage))
      });
    }

    // 失败：并行记录性能和增加失败计数
    await Promise.all([
      recordPerformance(kv, channel.id, payload.model, duration, response.ok),
      recordFailure(kv, breakerKey)
    ]);

    failures.push({
      channel: channel.name || channel.id,
      status: response.status,
      body: await readSmallBody(response)
    });
  }

  // 记录请求日志（失败）- 后台执行
  safeWaitUntil(context, logRequest(kv, {
    userId: auth.user.id,
    model: payload.model,
    status: 502,
    duration: Date.now() - startRequestTime,
    error: "All upstream channels failed",
    ip: clientIP
  }));

  return error(502, "upstream_error", "All upstream channels failed.", { failures });
}

async function _handleListModels(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return noContent();
  }
  if (request.method !== "GET") {
    return error(405, "method_not_allowed", "Only GET is supported.");
  }

  const auth = await authenticateUser(context);
  if (auth.error) return auth.error;

  const kv = getKv(context.env);
  const models = filterModelsForUser(await listModels(kv), auth.user);
  return json({
    object: "list",
    data: models.map((model) => ({
      id: model.model,
      object: "model",
      owned_by: "aiapi"
    }))
  });
}

async function handleChannels(context, id) {
  const { request } = context;
  const kv = getKv(context.env);

  if (request.method === "GET" && !id) {
    return json({ data: await listChannels(kv) });
  }

  if (request.method === "GET" && id) {
    const existing = await getJson(kv, channelKey(id));
    if (!existing) return error(404, "not_found", "Channel not found.");
    return json({ data: existing });
  }

  if (request.method === "POST" && !id) {
    const input = await readJson(request);
    const channel = normalizeChannel(input, createId("ch"));
    await putJson(kv, channelKey(channel.id), channel);
    return json({ data: publicChannel(channel) }, 201);
  }

  if (request.method === "PUT" && id) {
    const existing = await getJson(kv, channelKey(id));
    if (!existing) return error(404, "not_found", "Channel not found.");
    const input = await readJson(request);
    const channel = normalizeChannel({ ...existing, ...input, id }, id, existing);
    await putJson(kv, channelKey(id), channel);
    return json({ data: publicChannel(channel) });
  }

  if (request.method === "DELETE" && id) {
    await kv.delete(channelKey(id));
    return json({ ok: true });
  }

  return error(405, "method_not_allowed", "Method is not allowed for channels.");
}

async function handleModels(context, id) {
  const { request } = context;
  const kv = getKv(context.env);

  if (request.method === "POST" && id === "fetch") {
    const input = await readJson(request);
    const models = await fetchAvailableModels(kv, input);
    return json(models);
  }

  if (request.method === "POST" && id === "sync") {
    const input = await readJson(request);
    const models = await syncChannelModelMappings(kv, input);
    return json({ data: models });
  }

  if (request.method === "GET" && !id) {
    return json({ data: await listModels(kv) });
  }

  if (request.method === "PUT" && id) {
    const input = await readJson(request);
    const model = normalizeModel({ ...input, model: input.model || id });
    if (model.model !== id) {
      await kv.delete(modelKey(id));
    }
    await putJson(kv, modelKey(model.model), model);
    return json({ data: model });
  }

  if (request.method === "DELETE" && id) {
    await kv.delete(modelKey(id));
    return json({ ok: true });
  }

  return error(405, "method_not_allowed", "Method is not allowed for models.");
}

async function handleUsers(context, id) {
  const { request } = context;
  const kv = getKv(context.env);

  if (request.method === "GET" && !id) {
    return json({ data: await listUsers(kv) });
  }

  if (request.method === "POST" && !id) {
    const input = await readJson(request);
    const user = await normalizeUser(kv, input, createId("usr"));
    await putUser(kv, user);
    return json({ data: publicUser(user) }, 201);
  }

  if (request.method === "PUT" && id) {
    const existing = await getJson(kv, userKey(id));
    if (!existing) return error(404, "not_found", "User not found.");
    const input = await readJson(request);
    const user = await normalizeUser(kv, { ...existing, ...input, id }, id, existing);
    await putUser(kv, user, existing);
    return json({ data: publicUser(user) });
  }

  if (request.method === "DELETE" && id) {
    const existing = await getJson(kv, userKey(id));
    if (existing?.key_hash) {
      await kv.delete(userKeyHash(existing.key_hash));
    }
    if ((await getKvValue(kv, DEFAULT_USER_KEY)) === id) {
      await kv.delete(DEFAULT_USER_KEY);
    }
    await kv.delete(userKey(id));
    return json({ ok: true });
  }

  return error(405, "method_not_allowed", "Method is not allowed for users.");
}

function getKv(env) {
  const kv = env?.[KV_BINDING] || globalThis[KV_BINDING] || env?.AIAPI_KV || env?.aiapi_kv || env?.KV;
  if (!kv) {
    throw new Error(`KV binding ${KV_BINDING} is missing.`);
  }
  if (typeof kv === "object" && kv !== null) {
    kvDebugContexts.set(kv, env);
  }
  return kv;
}

async function handleAdminSession(context) {
  const { request, env } = context;

  if (request.method === "GET") {
    const valid = await validateAdminSession(request, env);
    return valid ? json({ authenticated: true }) : error(401, "unauthorized", "Admin session is invalid.");
  }

  if (request.method === "POST") {
    let input;
    try {
      input = await readJson(request);
    } catch (cause) {
      if (cause instanceof UserInputError) {
        return error(400, "invalid_request_error", cause.message);
      }
      throw cause;
    }
    const token = String(input.token || "");
    const tokenError = validateAdminToken(token, env);
    if (tokenError) return tokenError;

    const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
    const session = await createAdminSession(env, expiresAt);
    return withCookie(json({ ok: true, expires_at: expiresAt }), adminSessionCookie(session, request));
  }

  if (request.method === "DELETE") {
    return withCookie(json({ ok: true }), clearAdminSessionCookie(request));
  }

  return error(405, "method_not_allowed", "Method is not allowed for admin session.");
}

async function validateAdmin(request, env) {
  const expected = env?.ADMIN_TOKEN;
  if (!expected) {
    return error(500, "missing_admin_token", "ADMIN_TOKEN environment variable is not set.");
  }
  const actual = bearerToken(request);
  if (actual && constantTimeEqual(actual, expected)) {
    return null;
  }
  if (await validateAdminSession(request, env)) {
    return null;
  }
  return error(401, "unauthorized", "Invalid admin credentials.");
}

function validateAdminToken(token, env) {
  const expected = env?.ADMIN_TOKEN;
  if (!expected) {
    return error(500, "missing_admin_token", "ADMIN_TOKEN environment variable is not set.");
  }
  if (!token || !constantTimeEqual(token, expected)) {
    return error(401, "unauthorized", "Invalid admin token.");
  }
  return null;
}

async function createAdminSession(env, expiresAt) {
  const payload = `v1.${expiresAt}`;
  const signature = await hmacSha256(env.ADMIN_TOKEN, payload);
  return `${payload}.${signature}`;
}

async function validateAdminSession(request, env) {
  if (!env?.ADMIN_TOKEN) return false;
  const session = cookieValue(request, ADMIN_SESSION_COOKIE);
  if (!session) return false;

  const parts = session.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await hmacSha256(env.ADMIN_TOKEN, payload);
  return constantTimeEqual(parts[2], expected);
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rawValue] = part.trim().split("=");
    if (key === name) return rawValue.join("=");
  }
  return "";
}

function adminSessionCookie(session, request) {
  return `${ADMIN_SESSION_COOKIE}=${session}; Path=/api/admin; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secureCookieSuffix(request)}`;
}

function clearAdminSessionCookie(request) {
  return `${ADMIN_SESSION_COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; SameSite=Strict${secureCookieSuffix(request)}`;
}

function secureCookieSuffix(request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function withCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left));
  const rightBytes = new TextEncoder().encode(String(right));
  let diff = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return diff === 0;
}

async function authenticateUser(context) {
  const token = bearerToken(context.request);
  const kv = getKv(context.env);
  if (!token) {
    const defaultUser = await getDefaultUser(kv);
    if (defaultUser?.enabled) return { user: defaultUser };
    return { error: error(401, "unauthorized", "Missing bearer token and no default user is enabled.") };
  }

  const hash = await sha256(token);
  const userId = await getKvValue(kv, userKeyHash(hash));
  if (!userId) {
    return { error: error(401, "unauthorized", "Invalid API key.") };
  }

  const user = await getJson(kv, userKey(userId));
  if (!user?.enabled) {
    return { error: error(403, "forbidden", "API key is disabled.") };
  }
  return { user };
}

function validateModelAccess(user, model) {
  const allowedModels = normalizeAllowedModels(user?.allowed_models);
  if (!allowedModels.length || allowedModels.includes(model)) return null;
  return error(403, "model_not_allowed", `API key is not allowed to use model ${model}.`);
}

function filterModelsForUser(models, user) {
  const allowedModels = normalizeAllowedModels(user?.allowed_models);
  if (!allowedModels.length) return models;
  const allowed = new Set(allowedModels);
  return models.filter((model) => allowed.has(model.model));
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function getUpstreamOptions(env) {
  return {
    timeoutMs: positiveInteger(env?.UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS),
    retries: positiveInteger(env?.UPSTREAM_RETRIES, DEFAULT_UPSTREAM_RETRIES)
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
/* v8 ignore stop */

async function fetchWithRetry(url, init, options) {
  const retries = Math.max(0, options?.retries ?? DEFAULT_UPSTREAM_RETRIES);
  const timeoutMs = Math.max(1, options?.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS);
  let lastError = new UpstreamNetworkError(new Error("Upstream request failed."));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      if (!isRetriableStatus(response.status) || attempt === retries) {
        return response;
      }
    } catch (cause) {
      lastError = cause instanceof UpstreamTimeoutError ? cause : new UpstreamNetworkError(cause);
      if (attempt === retries) {
        throw lastError;
      }
    }

    await delay(RETRY_BASE_DELAY_MS * (attempt + 1));
  }

  throw lastError;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new UpstreamTimeoutError(timeoutMs)), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (cause) {
    if (cause?.name === "AbortError" || cause instanceof UpstreamTimeoutError) {
      throw new UpstreamTimeoutError(timeoutMs);
    }
    throw cause;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetriableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/* v8 ignore start */

async function fetchUpstream(channel, payload, originalRequest, options) {
  if (channel.type === "anthropic") {
    return fetchAnthropic(channel, payload, options);
  }
  if (channel.type === "gemini") {
    return fetchGemini(channel, payload, options);
  }

  const baseUrl = channel.base_url.replace(/\/+$/, "");
  const upstreamUrl = `${baseUrl}/chat/completions`;
  return fetchWithRetry(upstreamUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${channel.api_key}`,
      "content-type": "application/json",
      "accept": originalRequest.headers.get("accept") || "application/json"
    },
    body: JSON.stringify(payload)
  }, options);
}

async function fetchAnthropic(channel, payload, options) {
  const baseUrl = channel.base_url.replace(/\/+$/, "");
  const response = await fetchWithRetry(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": channel.api_key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify(toAnthropicPayload(payload))
  }, options);

  if (!response.ok) return response;
  const body = await response.json();
  return adaptedChatResponse(payload, fromAnthropicResponse(body), usageFromAnthropic(body));
}

async function fetchGemini(channel, payload, options) {
  const baseUrl = channel.base_url.replace(/\/+$/, "");
  const model = encodeURIComponent(modelIdFromPath(payload.model));
  const response = await fetchWithRetry(`${baseUrl}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": channel.api_key,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify(toGeminiPayload(payload))
  }, options);

  if (!response.ok) return response;
  const body = await response.json();
  return adaptedChatResponse(payload, fromGeminiResponse(body), usageFromGemini(body));
}

async function fetchAvailableModels(kv, input) {
  const channels = await resolveChannelsForModelFetch(kv, input);

  const data = [];
  const failures = [];

  for (const channel of channels) {
    try {
      const response = await fetchChannelModels(channel);
      if (!response.ok) {
        failures.push({
          channel_id: channel.id,
          channel_name: channel.name,
          status: response.status,
          body: await readSmallBody(response)
        });
        continue;
      }

      const body = await response.json();
      for (const item of body.data || []) {
        const id = String(item.id || "").trim();
        if (!id) continue;
        data.push({
          id,
          channel_id: channel.id,
          channel_name: channel.name
        });
      }
    } catch (cause) {
      failures.push({
        channel_id: channel.id,
        channel_name: channel.name,
        message: cause.message || "Failed to fetch models."
      });
    }
  }

  data.sort((left, right) => {
    const byModel = left.id.localeCompare(right.id);
    return byModel || left.channel_name.localeCompare(right.channel_name);
  });

  return { data, failures };
}

async function resolveChannelsForModelFetch(kv, input = {}) {
  if (input?.channel && typeof input.channel === "object") {
    const rawChannel = input.channel;
    const existingId = String(rawChannel.id || "").trim();
    const existing = existingId ? await getJson(kv, channelKey(existingId)) : {};
    const previewId = existingId || createId("preview");
    const channel = normalizeChannel({ ...existing, ...rawChannel, id: previewId }, previewId, existing || {});
    if (!channel.api_key) {
      throw new UserInputError("api_key is required to fetch upstream models for this channel.");
    }
    return [channel];
  }

  const selected = new Set(Array.isArray(input.channel_ids) ? input.channel_ids.map(String).filter(Boolean) : []);
  return (await listChannels(kv, { exposeSecrets: true })).filter((channel) => {
    if (!channel.enabled || !channel.api_key) return false;
    return selected.size === 0 || selected.has(channel.id);
  });
}

function fetchChannelModels(channel) {
  if (channel.type === "anthropic") {
    return fetchAnthropicModels(channel);
  }
  if (channel.type === "gemini") {
    return fetchGeminiModels(channel);
  }

  const baseUrl = channel.base_url.replace(/\/+$/, "");
  return fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      "authorization": `Bearer ${channel.api_key}`,
      "accept": "application/json"
    }
  });
}

async function fetchAnthropicModels(channel) {
  const baseUrl = channel.base_url.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      "x-api-key": channel.api_key,
      "anthropic-version": ANTHROPIC_VERSION,
      "accept": "application/json"
    }
  });

  if (!response.ok) return response;
  const body = await response.json();
  return modelListResponse((body.data || []).map((item) => item.id || item.name));
}

async function fetchGeminiModels(channel) {
  const baseUrl = channel.base_url.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      "x-goog-api-key": channel.api_key,
      "accept": "application/json"
    }
  });

  if (!response.ok) return response;
  const body = await response.json();
  return modelListResponse((body.models || []).map((item) => item.name || item.id));
}

function modelListResponse(modelIds) {
  const data = [...new Set(modelIds.map(modelIdFromPath).filter(Boolean))]
    .map((id) => ({ id }));
  return json({ data });
}

function modelIdFromPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("models/") ? text.slice("models/".length) : text;
}

function adaptedChatResponse(payload, content, usage) {
  const body = {
    id: createId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: payload.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content
      },
      finish_reason: "stop"
    }],
    usage
  };

  if (!payload.stream) {
    return json(body);
  }

  const encoder = new TextEncoder();
  const chunk = {
    id: body.id,
    object: "chat.completion.chunk",
    created: body.created,
    model: body.model,
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        content
      },
      finish_reason: "stop"
    }]
  };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      if (usage) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id: body.id,
          object: "chat.completion.chunk",
          created: body.created,
          model: body.model,
          choices: [],
          usage
        })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return withCors(new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  }));
}

function toAnthropicPayload(payload) {
  const system = [];
  const messages = [];

  for (const message of payload.messages) {
    if (message.role === "system") {
      system.push(textContent(message.content));
    } else if (message.role === "user" || message.role === "assistant") {
      messages.push({
        role: message.role,
        content: textContent(message.content)
      });
    }
  }

  return compactObject({
    model: payload.model,
    max_tokens: payload.max_tokens || 1024,
    temperature: payload.temperature,
    top_p: payload.top_p,
    system: system.length ? system.join("\n\n") : undefined,
    messages
  });
}

function toGeminiPayload(payload) {
  const contents = [];
  const systemInstruction = [];

  for (const message of payload.messages) {
    const text = textContent(message.content);
    if (!text) continue;
    if (message.role === "system") {
      systemInstruction.push({ text });
    } else {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text }]
      });
    }
  }

  return compactObject({
    contents,
    systemInstruction: systemInstruction.length ? { parts: systemInstruction } : undefined,
    generationConfig: compactObject({
      maxOutputTokens: payload.max_tokens,
      temperature: payload.temperature,
      topP: payload.top_p
    })
  });
}

function fromAnthropicResponse(body) {
  return (body.content || [])
    .map((part) => part?.text || "")
    .join("");
}

function fromGeminiResponse(body) {
  const parts = body.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part?.text || "").join("");
}

function usageFromAnthropic(body) {
  const input = Number(body.usage?.input_tokens || 0);
  const output = Number(body.usage?.output_tokens || 0);
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output
  };
}

function usageFromGemini(body) {
  const usage = body.usageMetadata || {};
  const input = Number(usage.promptTokenCount || 0);
  const output = Number(usage.candidatesTokenCount || 0);
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: Number(usage.totalTokenCount || input + output)
  };
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content || "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null)
  );
}

function selectCandidates(channels, mapping) {
  const allowed = new Set(mapping?.channel_ids || []);
  const filtered = channels.filter((channel) => {
    if (!channel.enabled || !channel.api_key) return false;
    return allowed.size === 0 || allowed.has(channel.id);
  });

  return filtered.sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0));
}

async function listChannels(kv, options = {}) {
  const rows = await listJson(kv, "channel_");
  const channels = options.exposeSecrets ? rows : rows.map(publicChannel);
  return channels.sort((left, right) => left.name.localeCompare(right.name));
}

async function listModels(kv) {
  const rows = await listJson(kv, "model_");
  return rows.sort((left, right) => left.model.localeCompare(right.model));
}

function resolveUpstreamModelForChannel(mapping, channelId, fallbackModel) {
  const explicit = mapping?.channel_mappings?.[channelId];
  if (explicit) return explicit;
  return mapping?.upstream_model || fallbackModel;
}

async function listUsers(kv) {
  const defaultUserId = await getKvValue(kv, DEFAULT_USER_KEY);
  const rows = await listJson(kv, "user_");
  return rows.map((user) => publicUser(user, defaultUserId)).sort((left, right) => left.name.localeCompare(right.name));
}

// 并行读取一批 KV key 的 JSON 值，单个失败/损坏不影响整批（降级返回成功的部分）。
// items 可以是字符串 key，或 kv.list 返回的 { name } / { key } 形式。
async function batchGetJson(kv, items) {
  const keys = (items || [])
    .map((item) => (typeof item === "string" ? item : item.name || item.key))
    .filter(Boolean);
  const settled = await Promise.allSettled(keys.map((key) => getJson(kv, key)));
  const values = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      values.push(result.value);
    }
  }
  return values;
}

async function listJson(kv, prefix) {
  const rows = [];
  let cursor;
  do {
    const options = { prefix, limit: 100 };
    if (cursor) {
      options.cursor = cursor;
    }
    const result = await kv.list(options);
    const keys = result.keys || result.list || [];
    // 并行读取本批次所有键，避免逐个 await 造成的串行网络往返；单个键损坏时降级跳过
    const values = await batchGetJson(kv, keys);
    for (const value of values) {
      rows.push(value);
    }
    cursor = result.cursor;
    if (result.complete !== false) break;
  } while (cursor);
  return rows;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new UserInputError("Request body must be valid JSON.");
  }
}

function normalizeChannel(input, id, existing = {}) {
  const apiKey = String(input.api_key || "").trim();
  const type = requiredString(input.type, "type");
  if (!CHANNEL_TYPES.has(type)) {
    throw new UserInputError("Unsupported channel type.");
  }
  return {
    id,
    name: requiredString(input.name, "name"),
    type,
    base_url: requiredString(input.base_url, "base_url").replace(/\/+$/, ""),
    api_key: apiKey || existing.api_key || "",
    enabled: Boolean(input.enabled),
    weight: Math.max(0, Number(input.weight || 0)),
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function normalizeModel(input) {
  const channelMappings = normalizeChannelMappings(input);
  const channelIds = [...new Set([
    ...normalizeModelChannelIds(input.channel_ids),
    ...Object.keys(channelMappings)
  ])];
  const fallbackUpstreamModel = String(
    input.upstream_model
    || channelMappings[channelIds.find((channelId) => channelId !== NO_CHANNEL_ID)]
    || input.model
  ).trim();

  return {
    model: requiredString(input.model, "model"),
    upstream_model: fallbackUpstreamModel,
    channel_ids: channelIds,
    channel_mappings: channelMappings,
    updated_at: new Date().toISOString()
  };
}

function normalizeChannelMappings(input) {
  const rawMappings = input?.channel_mappings && typeof input.channel_mappings === "object"
    ? input.channel_mappings
    : {};
  const normalized = {};

  for (const [channelId, upstreamModel] of Object.entries(rawMappings)) {
    const normalizedChannelId = String(channelId || "").trim();
    const normalizedUpstreamModel = String(upstreamModel || "").trim();
    if (!normalizedChannelId || normalizedChannelId === NO_CHANNEL_ID || !normalizedUpstreamModel) continue;
    normalized[normalizedChannelId] = normalizedUpstreamModel;
  }

  const fallbackUpstreamModel = String(input?.upstream_model || input?.model || "").trim();
  for (const channelId of normalizeModelChannelIds(input?.channel_ids)) {
    if (channelId === NO_CHANNEL_ID || normalized[channelId] || !fallbackUpstreamModel) continue;
    normalized[channelId] = fallbackUpstreamModel;
  }

  return normalized;
}

function normalizeModelChannelIds(channelIds) {
  return [...new Set(
    (Array.isArray(channelIds) ? channelIds : [])
      .map((channelId) => String(channelId || "").trim())
      .filter(Boolean)
  )];
}

async function syncChannelModelMappings(kv, input) {
  const channelId = requiredString(input.channel_id, "channel_id");

  // 支持新格式 model_mappings: [{model: "公开名", upstream_model: "上游名"}]
  // 或旧格式 model_ids: ["模型ID"]
  let modelMappingsMap = new Map(); // key: 上游模型, value: 公开模型名

  if (Array.isArray(input.model_mappings)) {
    // 新格式：支持自定义公开模型名称
    for (const mapping of input.model_mappings) {
      const upstreamModel = String(mapping.upstream_model || "").trim();
      const publicModel = String(mapping.model || "").trim() || upstreamModel;
      if (upstreamModel) {
        modelMappingsMap.set(upstreamModel, publicModel);
      }
    }
  } else if (Array.isArray(input.model_ids)) {
    // 旧格式兼容：model_ids，公开名称等于上游名称
    for (const modelId of input.model_ids) {
      const id = String(modelId || "").trim();
      if (id) {
        modelMappingsMap.set(id, id);
      }
    }
  }

  const existingModels = await listModels(kv);

  for (const existing of existingModels) {
    if (!existing?.model) continue;

    const currentChannelIds = normalizeModelChannelIds(existing.channel_ids);
    const currentMappings = normalizeChannelMappings(existing);
    const hadChannel = currentChannelIds.includes(channelId);
    const shouldHaveChannel = modelMappingsMap.has(existing.model);
    const publicModelName = modelMappingsMap.get(existing.model);

    let nextChannelIds = currentChannelIds;
    let nextMappings = currentMappings;

    if (shouldHaveChannel) {
      nextChannelIds = [...new Set([
        ...currentChannelIds.filter((item) => item !== NO_CHANNEL_ID),
        channelId
      ])];
      nextMappings = {
        ...currentMappings,
        [channelId]: publicModelName  // 使用自定义公开名称
      };
      modelMappingsMap.delete(existing.model);
    } else if (hadChannel) {
      nextChannelIds = currentChannelIds.filter((item) => item !== channelId && item !== NO_CHANNEL_ID);
      nextMappings = { ...currentMappings };
      delete nextMappings[channelId];
      if (!nextChannelIds.length) {
        nextChannelIds = [NO_CHANNEL_ID];
      }
    }

    if (
      sameStringSet(currentChannelIds, nextChannelIds)
      && sameFlatObject(currentMappings, nextMappings)
    ) {
      continue;
    }

    const normalized = normalizeModel({
      ...existing,
      channel_ids: nextChannelIds,
      channel_mappings: nextMappings
    });
    await putJson(kv, modelKey(normalized.model), normalized);
  }

  // 为剩余的模型创建新记录（这些是后端还没有的上游模型）
  for (const [upstreamModel, publicModel] of modelMappingsMap) {
    const model = normalizeModel({
      model: upstreamModel,
      upstream_model: upstreamModel,
      channel_ids: [channelId],
      channel_mappings: { [channelId]: publicModel }  // 使用自定义公开名称
    });
    await putJson(kv, modelKey(model.model), model);
  }

  return listModels(kv);
}

function sameStringSet(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  return [...leftSet].every((value) => rightSet.has(value));
}

function sameFlatObject(left, right) {
  const leftEntries = Object.entries(left || {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right || {}).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([leftKey, leftValue], index) => {
    const [rightKey, rightValue] = rightEntries[index];
    return leftKey === rightKey && leftValue === rightValue;
  });
}

async function normalizeUser(kv, input, id, existing = {}) {
  const apiKey = String(input.api_key || "").trim();
  const keyHash = apiKey ? await sha256(apiKey) : existing.key_hash;
  if (!keyHash) {
    throw new UserInputError("api_key is required for new users.");
  }
  const duplicateUserId = await getKvValue(kv, userKeyHash(keyHash));
  if (duplicateUserId && duplicateUserId !== id) {
    throw new UserInputError("api_key already belongs to another user.");
  }

  return {
    id,
    name: requiredString(input.name, "name"),
    key_hash: keyHash,
    api_key: apiKey || existing.api_key || "",
    allowed_models: normalizeAllowedModels(input.allowed_models),
    is_default: Boolean(input.is_default),
    enabled: Boolean(input.enabled),
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function putUser(kv, user, existing) {
  if (existing?.key_hash && existing.key_hash !== user.key_hash) {
    await kv.delete(userKeyHash(existing.key_hash));
  }
  await putJson(kv, userKey(user.id), user);
  await kv.put(userKeyHash(user.key_hash), user.id);
  if (user.is_default) {
    await kv.put(DEFAULT_USER_KEY, user.id);
  } else if (existing?.is_default || (await getKvValue(kv, DEFAULT_USER_KEY)) === user.id) {
    await kv.delete(DEFAULT_USER_KEY);
  }
}

function publicChannel(channel) {
  const { api_key, ...safe } = channel;
  return {
    ...safe,
    has_api_key: Boolean(api_key)
  };
}

function publicUser(user, defaultUserId = "") {
  const { key_hash, is_default, ...safe } = user;
  return {
    ...safe,
    allowed_models: normalizeAllowedModels(user.allowed_models),
    is_default: user.id === defaultUserId,
    has_api_key: Boolean(key_hash)
  };
}

function normalizeAllowedModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

async function getDefaultUser(kv) {
  const id = await getKvValue(kv, DEFAULT_USER_KEY);
  if (!id) return null;
  return getJson(kv, userKey(id));
}

function requiredString(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new UserInputError(`${field} is required.`);
  return text;
}

async function getJson(kv, key) {
  const value = await getKvValue(kv, key, { type: "json" });
  return value || null;
}

async function getKvValue(kv, key, options) {
  const startedAt = nowMs();
  try {
    const value = options === undefined ? await kv.get(key) : await kv.get(key, options);
    logKvGet(kv, key, startedAt, value !== null && value !== undefined);
    return value;
  } catch (cause) {
    logKvGet(kv, key, startedAt, false, cause);
    throw cause;
  }
}

function logKvGet(kv, key, startedAt, hit, cause) {
  // 仅在开发环境输出日志
  const env = kvDebugContexts.get(kv);
  if (shouldLogDebug(env)) {
    const duration = Math.round((nowMs() - startedAt) * 100) / 100;
    const status = cause ? "error" : (hit ? "hit" : "miss");
    writeLog("debug", `[kv.get] key=${key} duration_ms=${duration} status=${status}`, env);
  }
}

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function shouldLogDebug(env) {
  const mode = String(env?.NODE_ENV || env?.APP_ENV || env?.ENVIRONMENT || "").toLowerCase();
  const debugFlag = String(env?.AIAPI_DEBUG_LOGS || env?.DEBUG_LOGS || "").toLowerCase();
  return mode === "development" || mode === "dev" || ["1", "true", "yes", "on"].includes(debugFlag);
}

function writeLog(level, message, env) {
  if (!shouldLogDebug(env)) return;
  const logger = console[level] || console.log;
  logger.call(console, message);
}

function emitApiRequestLog(context, response, startedAt, cause) {
  const { request } = context;
  if (request.method === "OPTIONS") return;

  const url = new URL(request.url);
  const entry = {
    type: "api_request",
    timestamp: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
    status: response?.status ?? 500,
    duration_ms: Math.max(Date.now() - startedAt, 0),
    client_ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown"
  };

  if (cause) {
    entry.error = cause.message || String(cause);
  }

  const logger = cause ? console.error : console.log;
  logger.call(console, JSON.stringify(entry));
}

async function putJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

function channelKey(id) {
  return `channel_${safeId(id)}`;
}

function modelKey(model) {
  return `model_${hexKey(model)}`;
}

function userKey(id) {
  return `user_${safeId(id)}`;
}

function userKeyHash(hash) {
  return `userkey_${hash}`;
}

function createId(prefix) {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${suffix}`;
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_]/g, "_");
}

function hexKey(value) {
  const bytes = new TextEncoder().encode(String(value));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readSmallBody(response) {
  const text = await response.text().catch(() => "");
  return text.slice(0, 2000);
}

function json(data, status = 200) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders
  }));
}

function error(status, code, message, extra = {}) {
  return json({
    error: {
      code,
      message,
      ...extra
    }
  }, status);
}

function noContent() {
  return withCors(new Response(null, { status: 204 }));
}

function proxyUpstreamResponse(response, options = {}) {
  if (!isEventStream(response) || !response.body) {
    return withCors(response);
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");
  headers.delete("content-length");
  headers.delete("content-encoding");

  const { readable, writable } = new TransformStream();
  pipeEventStream(response.body, writable, options.onUsage);

  return withCors(new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers
  }));
}

function isEventStream(response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream");
}

function pipeEventStream(body, writable, onUsage) {
  const reader = body.getReader();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = "";
  let usageRecorded = false;

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        await writer.write(value);
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";

        for (const event of events) {
          if (usageRecorded) continue;
          const usage = usageFromSseEvent(event);
          if (usage) {
            usageRecorded = true;
            onUsage?.(usage);
          }
        }
      }

      if (buffer && !usageRecorded) {
        const usage = usageFromSseEvent(buffer);
        if (usage) onUsage?.(usage);
      }
      await writer.close();
    } catch (cause) {
      await writer.abort(cause).catch(() => {});
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  })();
}

function usageFromSseEvent(event) {
  for (const line of event.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const chunk = JSON.parse(data);
      if (chunk.usage) return normalizeUsage(chunk.usage);
    } catch {
      // Ignore non-JSON SSE payloads.
    }
  }
  return null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  };
}

function safeWaitUntil(context, promise) {
  const task = Promise.resolve(promise).catch((cause) => {
    if (shouldLogDebug(context?.env)) {
      writeLog("warn", `[waitUntil] ${cause.message || cause}`, context?.env);
    }
  });
  if (context.waitUntil) {
    context.waitUntil(task);
  }
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "Authorization,Content-Type,Accept");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Reflects the request origin when it matches ALLOWED_ORIGINS; no wildcard *.
function applyCors(response, request, env) {
  const headers = new Headers(response.headers);
  const requestOrigin = request?.headers?.get("origin") || "";
  const allowed = (env?.ALLOWED_ORIGINS || "")
    .split(",").map(o => o.trim()).filter(Boolean);
  if (allowed.length > 0) {
    if (allowed.includes(requestOrigin)) {
      headers.set("access-control-allow-origin", requestOrigin);
      headers.set("access-control-allow-credentials", "true");
    }
    headers.set("vary", "Origin");
  } else {
    // 仅在开发环境允许 localhost
    const isDev = shouldLogDebug(env);
    if (isDev) {
      headers.set("access-control-allow-origin", "http://localhost:5173");
      headers.set("access-control-allow-credentials", "true");
    } else {
      // 生产环境必须配置 ALLOWED_ORIGINS
      headers.set("vary", "Origin");
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// ============================================================================
// Circuit Breaker Functions
// ============================================================================

/**
 * 检查熔断器状态
 * @returns "closed" | "open" | "half_open"
 */
/* v8 ignore stop */
async function checkCircuitBreaker(kv, breakerKey) {
  const data = await getJson(kv, breakerKey);
  if (!data) return "closed";

  const now = Date.now();

  // 如果熔断器已打开
  if (data.state === "open") {
    // 检查是否超过熔断时间
    if (now - data.openedAt >= CIRCUIT_BREAKER_TIMEOUT) {
      // 进入半开状态
      await kv.put(breakerKey, JSON.stringify({
        state: "half_open",
        failures: 0,
        openedAt: data.openedAt,
        halfOpenAt: now,
        halfOpenRequests: 0
      }), { expirationTtl: 300 });
      return "half_open";
    }
    return "open";
  }

  // 半开状态：允许少量请求通过
  if (data.state === "half_open") {
    if (data.halfOpenRequests >= CIRCUIT_BREAKER_HALF_OPEN_REQUESTS) {
      return "open"; // 半开状态的请求配额用完
    }
    // 增加半开状态请求计数
    await kv.put(breakerKey, JSON.stringify({
      ...data,
      halfOpenRequests: (data.halfOpenRequests || 0) + 1
    }), { expirationTtl: 300 });
    return "half_open";
  }

  return "closed";
}

/**
 * 记录失败并可能打开熔断器
 */
/* v8 ignore start */
async function recordFailure(kv, breakerKey) {
  const data = await getJson(kv, breakerKey);
  const now = Date.now();

  if (!data) {
    // 首次失败
    await kv.put(breakerKey, JSON.stringify({
      state: "closed",
      failures: 1,
      lastFailure: now
    }), { expirationTtl: 300 });
    return;
  }

  const newFailures = (data.failures || 0) + 1;

  // 达到阈值，打开熔断器
  if (newFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    await kv.put(breakerKey, JSON.stringify({
      state: "open",
      failures: newFailures,
      openedAt: now,
      lastFailure: now
    }), { expirationTtl: 300 });
    return;
  }

  // 未达到阈值，继续记录
  await kv.put(breakerKey, JSON.stringify({
    ...data,
    failures: newFailures,
    lastFailure: now
  }), { expirationTtl: 300 });
}

/**
 * 重置熔断器（成功请求后）
 */
async function resetCircuitBreaker(kv, breakerKey) {
  const data = await getJson(kv, breakerKey);

  if (!data) return;

  // 如果是半开状态，成功后关闭熔断器
  if (data.state === "half_open" || data.state === "open") {
    await kv.delete(breakerKey);
    return;
  }

  // 减少失败计数
  if (data.failures > 0) {
    await kv.put(breakerKey, JSON.stringify({
      ...data,
      failures: Math.max(0, data.failures - 1)
    }), { expirationTtl: 300 });
  }
}

// ============================================================================
// Performance Monitoring Functions
// ============================================================================

/**
 * 记录性能指标
 */
async function recordPerformance(kv, channelId, model, duration, success) {
  const now = Date.now();
  const windowKey = getPerformanceWindow(now);
  const perfKey = performanceKey(channelId, model, windowKey);

  const data = await getJson(kv, perfKey) || {
    channelId,
    model,
    window: windowKey,
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalDuration: 0,
    minDuration: Infinity,
    maxDuration: 0
  };

  data.totalRequests += 1;
  if (success) {
    data.successRequests += 1;
  } else {
    data.failedRequests += 1;
  }
  data.totalDuration += duration;
  data.minDuration = Math.min(data.minDuration, duration);
  data.maxDuration = Math.max(data.maxDuration, duration);

  // 保留 1 小时
  await kv.put(perfKey, JSON.stringify(data), { expirationTtl: 3600 });
}

/**
 * 获取渠道性能统计
 */
async function getChannelPerformance(kv, channelId, model) {
  const now = Date.now();
  const currentWindow = getPerformanceWindow(now);

  // 读取最近 3 个窗口（15 分钟）的数据
  const windows = getPerformanceWindows(now, 3);
  const stats = [];

  for (const window of windows) {
    const perfKey = performanceKey(channelId, model, window);
    const data = await getJson(kv, perfKey);
    if (data) {
      stats.push(data);
    }
  }

  if (stats.length === 0) {
    return null;
  }

  // 聚合统计
  const aggregated = {
    channelId,
    model,
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    avgDuration: 0,
    minDuration: Infinity,
    maxDuration: 0,
    successRate: 0
  };

  for (const stat of stats) {
    aggregated.totalRequests += stat.totalRequests;
    aggregated.successRequests += stat.successRequests;
    aggregated.failedRequests += stat.failedRequests;
    aggregated.minDuration = Math.min(aggregated.minDuration, stat.minDuration);
    aggregated.maxDuration = Math.max(aggregated.maxDuration, stat.maxDuration);
  }

  const totalDuration = stats.reduce((sum, s) => sum + s.totalDuration, 0);
  aggregated.avgDuration = Math.round(totalDuration / aggregated.totalRequests);
  aggregated.successRate = aggregated.totalRequests > 0
    ? Math.round((aggregated.successRequests / aggregated.totalRequests) * 100)
    : 0;

  return aggregated;
}

function getPerformanceWindow(now = Date.now()) {
  return Math.floor(now / PERFORMANCE_WINDOW);
}

function getPerformanceWindows(now = Date.now(), count = 3) {
  const currentWindow = getPerformanceWindow(now);
  return Array.from({ length: count }, (_, index) => currentWindow - index);
}

function performanceKey(channelId, model, windowKey) {
  return `perf:${channelId}:${model}:${windowKey}`;
}

// ============================================================================
// Admin Health Check & Performance APIs
// ============================================================================

/**
 * 健康检查接口
 */
async function handleHealthCheck(context) {
  const kv = getKv(context.env);
  const channels = await listChannels(kv, { exposeSecrets: true });
  const models = await listModels(kv);

  const channelHealth = [];

  for (const channel of channels) {
    if (!channel.enabled) {
      channelHealth.push({
        id: channel.id,
        name: channel.name,
        status: "disabled",
        models: []
      });
      continue;
    }

    // 获取该渠道支持的模型
    const channelModels = models.filter(m => {
      const mapping = m;
      const allowed = mapping?.channel_ids || [];
      return allowed.length === 0 || allowed.includes(channel.id);
    });

    const modelHealth = [];

    for (const model of channelModels) {
      const breakerKey = `breaker:${channel.id}:${model.model}`;
      const breakerState = await checkCircuitBreaker(kv, breakerKey);
      const breakerData = await getJson(kv, breakerKey);
      const performance = await getChannelPerformance(kv, channel.id, model.model);

      modelHealth.push({
        model: model.model,
        circuitBreaker: {
          state: breakerState,
          failures: breakerData?.failures || 0,
          openedAt: breakerData?.openedAt || null,
          lastFailure: breakerData?.lastFailure || null
        },
        performance: performance || {
          totalRequests: 0,
          successRequests: 0,
          failedRequests: 0,
          avgDuration: 0,
          successRate: 0
        }
      });
    }

    channelHealth.push({
      id: channel.id,
      name: channel.name,
      status: channel.enabled ? "enabled" : "disabled",
      weight: channel.weight || 0,
      models: modelHealth
    });
  }

  return json({
    status: "ok",
    timestamp: Date.now(),
    channels: channelHealth
  });
}

/**
 * 性能统计接口
 */
async function handlePerformanceStats(context) {
  const { request } = context;
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");
  const model = url.searchParams.get("model");

  if (!channelId || !model) {
    return error(400, "invalid_request_error", "Query parameters 'channel' and 'model' are required.");
  }

  const kv = getKv(context.env);
  const performance = await getChannelPerformance(kv, channelId, model);

  if (!performance) {
    return json({
      channelId,
      model,
      message: "No performance data available for this channel and model."
    });
  }

  return json(performance);
}

/**
 * 处理使用统计查询
 */
async function handleUsageStats(context) {
  const { request } = context;
  const url = new URL(request.url);
  const userId = url.searchParams.get("user") || null;

  if (!userId) {
    return error(400, "invalid_request_error", "Missing user parameter.");
  }

  const kv = getKv(context.env);
  const stats = await getUserUsageStats(kv, userId);

  return json({
    userId,
    stats
  });
}

/**
 * 处理请求日志查询
 */
async function handleRequestLogs(context) {
  const { request } = context;
  const url = new URL(request.url);
  const userId = url.searchParams.get("user") || null;
  const limit = parseInt(url.searchParams.get("limit") || "100");

  const kv = getKv(context.env);
  const logs = await getRequestLogs(kv, { userId, limit });

  return json({
    logs,
    count: logs.length
  });
}

// ============================================================================
// Rate Limiting Functions
// ============================================================================

/**
 * 检查速率限制
 */
/* v8 ignore stop */
async function checkRateLimit(kv, request, user) {
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS);

  // 按用户限制
  const userLimit = user.rate_limit || DEFAULT_RATE_LIMIT;
  const userKey = `ratelimit:user:${user.id}:${windowStart}`;

  // 按 IP 限制（防止未认证攻击）
  const clientIP = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const ipLimit = 120; // IP 限制更宽松
  const ipKey = `ratelimit:ip:${clientIP}:${windowStart}`;

  // 并行查询用户和IP计数
  const [userCountStr, ipCountStr] = await Promise.all([
    kv.get(userKey),
    kv.get(ipKey)
  ]);

  const userCount = parseInt(userCountStr || "0");
  const ipCount = parseInt(ipCountStr || "0");
  const resetAt = windowStart * RATE_LIMIT_WINDOW_MS + RATE_LIMIT_WINDOW_MS;
  const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

  // 检查用户限制
  if (userCount >= userLimit) {
    return errorWithHeaders(429, "rate_limit_exceeded", "Rate limit exceeded. Try again later.", {
      "X-RateLimit-Limit": String(userLimit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(resetAt),
      "Retry-After": String(retryAfter)
    }, {
      scope: "user",
      limit: userLimit,
      remaining: 0,
      reset_at: resetAt,
      retry_after: retryAfter
    });
  }

  // 检查IP限制
  if (ipCount >= ipLimit) {
    return errorWithHeaders(429, "rate_limit_exceeded", "Too many requests from this IP.", {
      "X-RateLimit-Limit": String(ipLimit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(resetAt),
      "Retry-After": String(retryAfter)
    }, {
      scope: "ip",
      limit: ipLimit,
      remaining: 0,
      reset_at: resetAt,
      retry_after: retryAfter
    });
  }

  // 并行增加计数
  await Promise.all([
    kv.put(userKey, String(userCount + 1), { expirationTtl: 120 }),
    kv.put(ipKey, String(ipCount + 1), { expirationTtl: 120 })
  ]);

  return null; // 通过检查
}

/**
 * 返回带自定义头的错误响应
 */
function errorWithHeaders(status, type, message, headers = {}, extra = {}) {
  const response = error(status, type, message, extra);
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// ============================================================================
// Usage Statistics Functions
// ============================================================================

/**
 * 记录使用统计
 */
async function recordUsage(kv, userId, channelId, model, usage) {
  const now = Date.now();
  const dateKey = new Date(now).toISOString().split('T')[0]; // YYYY-MM-DD

  const usageKey = `usage:${userId}:${dateKey}:${now}`;
  const usageData = {
    userId,
    channelId,
    model,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    timestamp: now
  };

  // 保留 30 天
  await kv.put(usageKey, JSON.stringify(usageData), { expirationTtl: 86400 * 30 });
}

/**
 * 获取用户使用统计
 */
async function getUserUsageStats(kv, userId, startDate, endDate) {
  const stats = {
    totalRequests: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {}
  };

  // 简化版：读取最近的使用记录
  const prefix = `usage:${userId}:`;
  const result = await kv.list({ prefix, limit: 1000 });

  // 并行读取所有记录，避免逐个 await 造成的串行延迟；单条损坏时降级跳过
  const records = await batchGetJson(kv, result.keys);

  for (const data of records) {
    if (!data) continue;

    stats.totalRequests += 1;
    stats.totalTokens += data.totalTokens || 0;

    // 按模型统计
    if (!stats.byModel[data.model]) {
      stats.byModel[data.model] = {
        requests: 0,
        tokens: 0
      };
    }
    stats.byModel[data.model].requests += 1;
    stats.byModel[data.model].tokens += data.totalTokens || 0;
  }

  // 简单的成本估算（基于 OpenAI 定价）
  stats.totalCost = estimateCost(stats.byModel);

  return stats;
}

/**
 * 估算成本（美元）
 */
function estimateCost(byModel) {
  const pricing = {
    "gpt-4o": { input: 2.5, output: 10 }, // per 1M tokens
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10, output: 30 },
    "gpt-4": { input: 30, output: 60 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 }
  };

  let totalCost = 0;
  for (const [model, stats] of Object.entries(byModel)) {
    const price = pricing[model] || pricing["gpt-4o-mini"]; // 默认使用最便宜的
    // 简化：假设输入输出各占一半
    const avgPrice = (price.input + price.output) / 2;
    totalCost += (stats.tokens / 1000000) * avgPrice;
  }

  return parseFloat(totalCost.toFixed(4));
}

// ============================================================================
// Request Logging Functions
// ============================================================================

/**
 * 记录请求日志
 */
/* v8 ignore start */
async function logRequest(kv, logData) {
  const now = Date.now();
  const logKey = `log:${now}:${randomId()}`;

  const log = {
    timestamp: now,
    userId: logData.userId,
    model: logData.model,
    status: logData.status,
    duration: logData.duration,
    error: logData.error || null,
    ip: logData.ip || "unknown"
  };

  // 保留 7 天
  await kv.put(logKey, JSON.stringify(log), { expirationTtl: 86400 * 7 });
}

/**
 * 获取请求日志
 */
async function getRequestLogs(kv, options = {}) {
  const { limit = 100, userId = null } = options;
  const logs = [];

  const result = await kv.list({ prefix: "log:", limit });

  // 并行读取本批日志，避免逐个 await 造成的串行延迟；单条损坏时降级跳过
  const fetched = await batchGetJson(kv, result.keys);

  for (const log of fetched) {
    if (!log) continue;

    // 如果指定了 userId，过滤
    if (userId && log.userId !== userId) continue;

    logs.push(log);
  }

  // 按时间倒序
  logs.sort((a, b) => b.timestamp - a.timestamp);

  return logs.slice(0, limit);
}

/**
 * 生成随机 ID
 */
function randomId() {
  return Math.random().toString(36).substring(2, 15);
}
/* v8 ignore stop */

export async function handleAdminRequest(context) {
  const startedAt = Date.now();
  try {
    const response = await _handleAdminRequest(context);
    emitApiRequestLog(context, response, startedAt);
    return applyCors(response, context.request, context.env);
  } catch (cause) {
    emitApiRequestLog(context, null, startedAt, cause);
    throw cause;
  }
}

export async function handleChatCompletions(context) {
  const startedAt = Date.now();
  try {
    const response = await _handleChatCompletions(context);
    emitApiRequestLog(context, response, startedAt);
    return applyCors(response, context.request, context.env);
  } catch (cause) {
    emitApiRequestLog(context, null, startedAt, cause);
    throw cause;
  }
}

export async function handleListModels(context) {
  const startedAt = Date.now();
  try {
    const response = await _handleListModels(context);
    emitApiRequestLog(context, response, startedAt);
    return applyCors(response, context.request, context.env);
  } catch (cause) {
    emitApiRequestLog(context, null, startedAt, cause);
    throw cause;
  }
}

export {
  getChannelPerformance,
  getPerformanceWindow,
  getPerformanceWindows,
  listChannels,
  checkCircuitBreaker,
  checkRateLimit,
  fetchWithRetry,
  getUserUsageStats,
  recordPerformance,
  recordUsage
};
