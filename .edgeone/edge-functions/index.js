
      let global = globalThis;
      globalThis.global = globalThis;

      if (typeof global.navigator === 'undefined') {
        global.navigator = {
          userAgent: 'edge-runtime',
          language: 'en-US',
          languages: ['en-US'],
        };
      } else {
        if (typeof global.navigator.language === 'undefined') {
          global.navigator.language = 'en-US';
        }
        if (!global.navigator.languages || global.navigator.languages.length === 0) {
          global.navigator.languages = [global.navigator.language];
        }
        if (typeof global.navigator.userAgent === 'undefined') {
          global.navigator.userAgent = 'edge-runtime';
        }
      }

      class MessageChannel {
        constructor() {
          this.port1 = new MessagePort();
          this.port2 = new MessagePort();
        }
      }
      class MessagePort {
        constructor() {
          this.onmessage = null;
        }
        postMessage(data) {
          if (this.onmessage) {
            setTimeout(() => this.onmessage({ data }), 0);
          }
        }
      }
      global.MessageChannel = MessageChannel;

      '__MIDDLEWARE_BUNDLE_CODE__'

      function recreateRequest(request, overrides = {}) {
        const cloned = typeof request.clone === 'function' ? request.clone() : request;
        const headers = new Headers(cloned.headers);

        if (overrides.headerPatches) {
          Object.keys(overrides.headerPatches).forEach((key) => {
            const value = overrides.headerPatches[key];
            if (value === null || typeof value === 'undefined') {
              headers.delete(key);
            } else {
              headers.set(key, value);
            }
          });
        }

        if (overrides.headers) {
          const extraHeaders = new Headers(overrides.headers);
          extraHeaders.forEach((value, key) => headers.set(key, value));
        }

        const url = overrides.url || cloned.url;
        const method = overrides.method || cloned.method || 'GET';
        const canHaveBody = method && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
        const body = overrides.body !== undefined ? overrides.body : canHaveBody ? cloned.body : undefined;

        // 如果rewrite传入的是完整URL（第三方地址），需要更新host
        if (overrides.url) {
          try {
            const newUrl = new URL(overrides.url, cloned.url);
            // 只有当新URL是绝对路径（包含协议和host）时才更新host
            if (overrides.url.startsWith('http://') || overrides.url.startsWith('https://')) {
              headers.set('host', newUrl.host);
            }
            // 相对路径时保持原有host不变
          } catch (e) {
            // URL解析失败时保持原有host
          }
        }

        const init = {
          method,
          headers,
          redirect: cloned.redirect,
          credentials: cloned.credentials,
          cache: cloned.cache,
          mode: cloned.mode,
          referrer: cloned.referrer,
          referrerPolicy: cloned.referrerPolicy,
          integrity: cloned.integrity,
          keepalive: cloned.keepalive,
          signal: cloned.signal,
        };

        if (canHaveBody && body !== undefined) {
          init.body = body;
        }

        if ('duplex' in cloned) {
          init.duplex = cloned.duplex;
        }

        return new Request(url, init);

      }

      

      function usercode(ev, hookCtx) {
        hookCtx = hookCtx || { fetch: globalThis.fetch };
        const { fetch } = hookCtx;
        const globalthis = hookCtx;
        "use strict";
        // ↓ 用户原始代码
        return (async function handleRequest(context) {
          let routeParams = {};
          let pagesFunctionResponse = null;
          let request = context.request;
          const waitUntil = context.waitUntil;
          let urlInfo = new URL(request.url);
          const eo = request.eo || {};


          const normalizePathname = () => {
            if (urlInfo.pathname !== '/' && urlInfo.pathname.endsWith('/')) {
              urlInfo.pathname = urlInfo.pathname.slice(0, -1);
            }
          };

          function getSuffix(pathname = '') {
            // Use a regular expression to extract the file extension from the URL
            const suffix = pathname.match(/\.([^\.]+)$/);
            // If an extension is found, return it, otherwise return an empty string
            return suffix ? '.' + suffix[1] : null;
          }

          normalizePathname();

          let matchedFunc = false;

          
        const runEdgeFunctions = () => {
          
          if(!matchedFunc && '/v1/chat/completions' === urlInfo.pathname) {
            matchedFunc = true;
              (() => {
  // lib/shared.js
  var KV_BINDING = "AIAPI_KV";
  var DEFAULT_USER_KEY = "default_user";
  var jsonHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
  async function handleChatCompletions(context) {
    const { request } = context;
    if (request.method === "OPTIONS") {
      return noContent();
    }
    if (request.method !== "POST") {
      return error(405, "method_not_allowed", "Only POST is supported.");
    }
    const auth = await authenticateUser(context);
    if (auth.error)
      return auth.error;
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
    if (accessError)
      return accessError;
    const kv = getKv(context.env);
    const mapping = await getJson(kv, modelKey(payload.model));
    const channels = await listChannels(kv, { exposeSecrets: true });
    const candidates = selectCandidates(channels, mapping);
    if (!candidates.length) {
      return error(503, "no_available_channel", `No enabled channel is available for model ${payload.model}.`);
    }
    const upstreamPayload = {
      ...payload,
      model: mapping?.upstream_model || payload.model
    };
    const failures = [];
    for (const channel of candidates) {
      const response = await fetchUpstream(channel, upstreamPayload, request);
      if (response.ok) {
        return proxyUpstreamResponse(response);
      }
      failures.push({
        channel: channel.name || channel.id,
        status: response.status,
        body: await readSmallBody(response)
      });
    }
    return error(502, "upstream_error", "All upstream channels failed.", { failures });
  }
  function getKv(env) {
    const kv = env?.[KV_BINDING] || globalThis[KV_BINDING] || env?.AIAPI_KV || env?.aiapi_kv || env?.KV;
    if (!kv) {
      throw new Error(`KV binding ${KV_BINDING} is missing.`);
    }
    return kv;
  }
  async function authenticateUser(context) {
    const token = bearerToken(context.request);
    const kv = getKv(context.env);
    if (!token) {
      const defaultUser = await getDefaultUser(kv);
      if (defaultUser?.enabled)
        return { user: defaultUser };
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
    if (!allowedModels.length || allowedModels.includes(model))
      return null;
    return error(403, "model_not_allowed", `API key is not allowed to use model ${model}.`);
  }
  function bearerToken(request) {
    const header = request.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
  }
  async function fetchUpstream(channel, payload, originalRequest) {
    const baseUrl = channel.base_url.replace(/\/+$/, "");
    const upstreamUrl = `${baseUrl}/chat/completions`;
    return fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${channel.api_key}`,
        "content-type": "application/json",
        "accept": originalRequest.headers.get("accept") || "application/json"
      },
      body: JSON.stringify(payload)
    });
  }
  function selectCandidates(channels, mapping) {
    const allowed = new Set(mapping?.channel_ids || []);
    const filtered = channels.filter((channel) => {
      if (!channel.enabled || !channel.api_key)
        return false;
      return allowed.size === 0 || allowed.has(channel.id);
    });
    return filtered.sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0));
  }
  async function listChannels(kv, options = {}) {
    const rows = await listJson(kv, "channel_");
    const channels = options.exposeSecrets ? rows : rows.map(publicChannel);
    return channels.sort((left, right) => left.name.localeCompare(right.name));
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
      for (const item of keys) {
        const key = typeof item === "string" ? item : item.name || item.key;
        if (!key)
          continue;
        const value = await getJson(kv, key);
        if (value)
          rows.push(value);
      }
      cursor = result.cursor;
      if (result.complete !== false)
        break;
    } while (cursor);
    return rows;
  }
  function publicChannel(channel) {
    const { api_key, ...safe } = channel;
    return {
      ...safe,
      has_api_key: Boolean(api_key)
    };
  }
  function normalizeAllowedModels(value) {
    if (!Array.isArray(value))
      return [];
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  async function getDefaultUser(kv) {
    const id = await getKvValue(kv, DEFAULT_USER_KEY);
    if (!id)
      return null;
    return getJson(kv, userKey(id));
  }
  async function getJson(kv, key) {
    const value = await getKvValue(kv, key, { type: "json" });
    return value || null;
  }
  async function getKvValue(kv, key, options) {
    const startedAt = nowMs();
    try {
      const value = options === void 0 ? await kv.get(key) : await kv.get(key, options);
      logKvGet(key, startedAt, value !== null && value !== void 0);
      return value;
    } catch (cause) {
      logKvGet(key, startedAt, false, cause);
      throw cause;
    }
  }
  function logKvGet(key, startedAt, hit, cause) {
    const duration = Math.round((nowMs() - startedAt) * 100) / 100;
    const status = cause ? "error" : hit ? "hit" : "miss";
    console.log(`[kv.get] key=${key} duration_ms=${duration} status=${status}`);
  }
  function nowMs() {
    return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
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
    return text.slice(0, 2e3);
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
  function proxyUpstreamResponse(response) {
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
    response.body.pipeTo(writable).catch(() => {
    });
    return withCors(new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers
    }));
  }
  function isEventStream(response) {
    return (response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream");
  }
  function withCors(response) {
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
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

  // edge-functions/v1/chat/completions.js
  async function onRequest(context) {
    return handleChatCompletions(context);
  }
  var completions_default = onRequest;

        pagesFunctionResponse = onRequest;
      })();
          }
        

          if(!matchedFunc && '/v1/models' === urlInfo.pathname) {
            matchedFunc = true;
              (() => {
  // lib/shared.js
  var KV_BINDING = "AIAPI_KV";
  var DEFAULT_USER_KEY = "default_user";
  var jsonHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
  async function handleListModels(context) {
    const { request } = context;
    if (request.method === "OPTIONS") {
      return noContent();
    }
    if (request.method !== "GET") {
      return error(405, "method_not_allowed", "Only GET is supported.");
    }
    const auth = await authenticateUser(context);
    if (auth.error)
      return auth.error;
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
  function getKv(env) {
    const kv = env?.[KV_BINDING] || globalThis[KV_BINDING] || env?.AIAPI_KV || env?.aiapi_kv || env?.KV;
    if (!kv) {
      throw new Error(`KV binding ${KV_BINDING} is missing.`);
    }
    return kv;
  }
  async function authenticateUser(context) {
    const token = bearerToken(context.request);
    const kv = getKv(context.env);
    if (!token) {
      const defaultUser = await getDefaultUser(kv);
      if (defaultUser?.enabled)
        return { user: defaultUser };
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
  function filterModelsForUser(models, user) {
    const allowedModels = normalizeAllowedModels(user?.allowed_models);
    if (!allowedModels.length)
      return models;
    const allowed = new Set(allowedModels);
    return models.filter((model) => allowed.has(model.model));
  }
  function bearerToken(request) {
    const header = request.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
  }
  async function listModels(kv) {
    const rows = await listJson(kv, "model_");
    return rows.sort((left, right) => left.model.localeCompare(right.model));
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
      for (const item of keys) {
        const key = typeof item === "string" ? item : item.name || item.key;
        if (!key)
          continue;
        const value = await getJson(kv, key);
        if (value)
          rows.push(value);
      }
      cursor = result.cursor;
      if (result.complete !== false)
        break;
    } while (cursor);
    return rows;
  }
  function normalizeAllowedModels(value) {
    if (!Array.isArray(value))
      return [];
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  async function getDefaultUser(kv) {
    const id = await getKvValue(kv, DEFAULT_USER_KEY);
    if (!id)
      return null;
    return getJson(kv, userKey(id));
  }
  async function getJson(kv, key) {
    const value = await getKvValue(kv, key, { type: "json" });
    return value || null;
  }
  async function getKvValue(kv, key, options) {
    const startedAt = nowMs();
    try {
      const value = options === void 0 ? await kv.get(key) : await kv.get(key, options);
      logKvGet(key, startedAt, value !== null && value !== void 0);
      return value;
    } catch (cause) {
      logKvGet(key, startedAt, false, cause);
      throw cause;
    }
  }
  function logKvGet(key, startedAt, hit, cause) {
    const duration = Math.round((nowMs() - startedAt) * 100) / 100;
    const status = cause ? "error" : hit ? "hit" : "miss";
    console.log(`[kv.get] key=${key} duration_ms=${duration} status=${status}`);
  }
  function nowMs() {
    return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  }
  function userKey(id) {
    return `user_${safeId(id)}`;
  }
  function userKeyHash(hash) {
    return `userkey_${hash}`;
  }
  function safeId(value) {
    return String(value).replace(/[^A-Za-z0-9_]/g, "_");
  }
  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  function withCors(response) {
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
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

  // edge-functions/v1/models.js
  async function onRequest(context) {
    return handleListModels(context);
  }
  var models_default = onRequest;

        pagesFunctionResponse = onRequest;
      })();
          }
        

          if(!matchedFunc && /^\/api\/(.+?)$/.test(urlInfo.pathname)) {
            routeParams = {"id":"default","mode":2,"left":"/api/"};
            matchedFunc = true;
            (() => {
  // lib/shared.js
  var KV_BINDING = "AIAPI_KV";
  var DEFAULT_USER_KEY = "default_user";
  var jsonHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
  var UserInputError = class extends Error {
  };
  async function handleAdminRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return noContent();
    }
    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }
    const adminError = validateAdmin(request, context.env);
    if (adminError)
      return adminError;
    const segments = url.pathname.split("/").filter(Boolean);
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
      return error(404, "not_found", "Admin resource not found.");
    } catch (cause) {
      if (cause instanceof UserInputError) {
        return error(400, "invalid_request_error", cause.message);
      }
      return error(500, "internal_error", cause.message || "Internal server error.");
    }
  }
  async function handleChannels(context, id) {
    const { request } = context;
    const kv = getKv(context.env);
    if (request.method === "GET" && !id) {
      return json({ data: await listChannels(kv) });
    }
    if (request.method === "GET" && id) {
      const existing = await getJson(kv, channelKey(id));
      if (!existing)
        return error(404, "not_found", "Channel not found.");
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
      if (!existing)
        return error(404, "not_found", "Channel not found.");
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
      if (!existing)
        return error(404, "not_found", "User not found.");
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
      if (await getKvValue(kv, DEFAULT_USER_KEY) === id) {
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
    return kv;
  }
  function validateAdmin(request, env) {
    const expected = env?.ADMIN_TOKEN;
    if (!expected) {
      return error(500, "missing_admin_token", "ADMIN_TOKEN environment variable is not set.");
    }
    const actual = bearerToken(request);
    if (!actual || actual !== expected) {
      return error(401, "unauthorized", "Invalid admin token.");
    }
    return null;
  }
  function bearerToken(request) {
    const header = request.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
  }
  async function fetchAvailableModels(kv, input) {
    const selected = new Set(Array.isArray(input.channel_ids) ? input.channel_ids.map(String).filter(Boolean) : []);
    const channels = (await listChannels(kv, { exposeSecrets: true })).filter((channel) => {
      if (!channel.enabled || !channel.api_key)
        return false;
      return selected.size === 0 || selected.has(channel.id);
    });
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
          if (!id)
            continue;
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
  function fetchChannelModels(channel) {
    const baseUrl = channel.base_url.replace(/\/+$/, "");
    return fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        "authorization": `Bearer ${channel.api_key}`,
        "accept": "application/json"
      }
    });
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
  async function listUsers(kv) {
    const defaultUserId = await getKvValue(kv, DEFAULT_USER_KEY);
    const rows = await listJson(kv, "user_");
    return rows.map((user) => publicUser(user, defaultUserId)).sort((left, right) => left.name.localeCompare(right.name));
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
      for (const item of keys) {
        const key = typeof item === "string" ? item : item.name || item.key;
        if (!key)
          continue;
        const value = await getJson(kv, key);
        if (value)
          rows.push(value);
      }
      cursor = result.cursor;
      if (result.complete !== false)
        break;
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
    if (type !== "openai") {
      throw new UserInputError("Only openai channel type is supported.");
    }
    return {
      id,
      name: requiredString(input.name, "name"),
      type,
      base_url: requiredString(input.base_url, "base_url").replace(/\/+$/, ""),
      api_key: apiKey || existing.api_key || "",
      enabled: Boolean(input.enabled),
      weight: Math.max(0, Number(input.weight || 0)),
      created_at: existing.created_at || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function normalizeModel(input) {
    return {
      model: requiredString(input.model, "model"),
      upstream_model: String(input.upstream_model || input.model).trim(),
      channel_ids: Array.isArray(input.channel_ids) ? input.channel_ids.map(String).filter(Boolean) : [],
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
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
      created_at: existing.created_at || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
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
    } else if (existing?.is_default || await getKvValue(kv, DEFAULT_USER_KEY) === user.id) {
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
    if (!Array.isArray(value))
      return [];
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  function requiredString(value, field) {
    const text = String(value || "").trim();
    if (!text)
      throw new UserInputError(`${field} is required.`);
    return text;
  }
  async function getJson(kv, key) {
    const value = await getKvValue(kv, key, { type: "json" });
    return value || null;
  }
  async function getKvValue(kv, key, options) {
    const startedAt = nowMs();
    try {
      const value = options === void 0 ? await kv.get(key) : await kv.get(key, options);
      logKvGet(key, startedAt, value !== null && value !== void 0);
      return value;
    } catch (cause) {
      logKvGet(key, startedAt, false, cause);
      throw cause;
    }
  }
  function logKvGet(key, startedAt, hit, cause) {
    const duration = Math.round((nowMs() - startedAt) * 100) / 100;
    const status = cause ? "error" : hit ? "hit" : "miss";
    console.log(`[kv.get] key=${key} duration_ms=${duration} status=${status}`);
  }
  function nowMs() {
    return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
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
    return text.slice(0, 2e3);
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
  function withCors(response) {
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
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

  // edge-functions/api/[[default]].js
  async function onRequest(context) {
    return handleAdminRequest(context);
  }
  var default_default = onRequest;

        pagesFunctionResponse = onRequest;
      })();
          }
        
        };
      

          let middlewareResponseHeaders = null;

          // 走到这里说明：
          // 1. 没有中间件响应（middlewareResponse 为 null/undefined）
          // 2. 或者中间件返回了 next
          // 需要判断是否命中边缘函数

          runEdgeFunctions();

          //没有命中边缘函数，执行回源
          if (!matchedFunc) {
            const originResponse = await fetch(request);

            // 如果中间件设置了响应头，合并到回源响应中
            if (middlewareResponseHeaders) {
              const mergedHeaders = new Headers(originResponse.headers);
              // 删除可能导致问题的编码相关头
              mergedHeaders.delete('content-encoding');
              mergedHeaders.delete('content-length');
              middlewareResponseHeaders.forEach((value, key) => {
                if (key.toLowerCase() === 'set-cookie') {
                  mergedHeaders.append(key, value);
                } else {
                  mergedHeaders.set(key, value);
                }
              });
              return new Response(originResponse.body, {
                status: originResponse.status,
                statusText: originResponse.statusText,
                headers: mergedHeaders,
              });
            }

            return originResponse;
          }

          // 命中了边缘函数，继续执行边缘函数逻辑

          const params = {};
          if (routeParams.id) {
            if (routeParams.mode === 1) {
              const value = urlInfo.pathname.match(routeParams.left);
              for (let i = 1; i < value.length; i++) {
                params[routeParams.id[i - 1]] = value[i];
              }
            } else {
              const value = urlInfo.pathname.replace(routeParams.left, '');
              const splitedValue = value.split('/');
              if (splitedValue.length === 1) {
                params[routeParams.id] = splitedValue[0];
              } else {
                params[routeParams.id] = splitedValue;
              }
            }

          }
          const edgeFunctionResponse = await pagesFunctionResponse({request, params, env: {"ADMIN_TOKEN":"xiaotian","password":"xiaotian","EO_KV_BINDINGS":"[{\"name\":\"AIAPI_KV\",\"type\":\"edgekv\",\"serviceName\":\"global-kv.3aaowu4fdpoy.eo.dnse5.com\",\"servicePort\":\"80\",\"userId\":\"Jwk-yw==\",\"userKey\":\"Pages-AppId-1302086665\",\"namespace\":\"Jwk-ywxG,Jwk-ywxG7yw=\"}]"}, waitUntil, eo });

          // 如果中间件设置了响应头，合并到边缘函数响应中
          if (middlewareResponseHeaders && edgeFunctionResponse) {
            const mergedHeaders = new Headers(edgeFunctionResponse.headers);
            // 删除可能导致问题的编码相关头
            mergedHeaders.delete('content-encoding');
            mergedHeaders.delete('content-length');
            middlewareResponseHeaders.forEach((value, key) => {
              if (key.toLowerCase() === 'set-cookie') {
                mergedHeaders.append(key, value);
              } else {
                mergedHeaders.set(key, value);
              }
            });
            return new Response(edgeFunctionResponse.body, {
              status: edgeFunctionResponse.status,
              statusText: edgeFunctionResponse.statusText,
              headers: mergedHeaders,
            });
          }

          return edgeFunctionResponse;
        })({request: ev.request, params: {}, env: {"ADMIN_TOKEN":"xiaotian","password":"xiaotian","EO_KV_BINDINGS":"[{\"name\":\"AIAPI_KV\",\"type\":\"edgekv\",\"serviceName\":\"global-kv.3aaowu4fdpoy.eo.dnse5.com\",\"servicePort\":\"80\",\"userId\":\"Jwk-yw==\",\"userKey\":\"Pages-AppId-1302086665\",\"namespace\":\"Jwk-ywxG,Jwk-ywxG7yw=\"}]"}, waitUntil: ev.waitUntil.bind(ev) });
        // ↑ 用户原始代码结束
      }

      addEventListener('fetch', (event, hookCtx) => {
        const res = usercode(event, hookCtx);
        event.respondWith(res);
      });