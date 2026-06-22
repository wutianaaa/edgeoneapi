export async function adminRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return readResponse(response);
}

export async function loginAdmin(token) {
  return adminRequest("/api/admin/session", {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export async function logoutAdmin() {
  return adminRequest("/api/admin/session", { method: "DELETE" });
}

export async function getAdminSession() {
  return adminRequest("/api/admin/session");
}

export async function chatRequest(payload, signal) {
  const response = await fetch("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": payload.stream ? "text/event-stream" : "application/json"
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    await readResponse(response);
  }

  return response;
}

export async function listPublicModels() {
  const response = await fetch("/v1/models", {
    headers: {
      "Accept": "application/json"
    }
  });
  return readResponse(response);
}

export async function listAdminModels() {
  return adminRequest("/api/admin/models");
}

export async function fetchUpstreamModels(channelIds = []) {
  return adminRequest("/api/admin/models/fetch", {
    method: "POST",
    body: JSON.stringify({ channel_ids: channelIds })
  });
}

export async function fetchUpstreamModelsForChannel(channel) {
  return adminRequest("/api/admin/models/fetch", {
    method: "POST",
    body: JSON.stringify({ channel })
  });
}

export async function syncChannelModels(payload) {
  return adminRequest("/api/admin/models/sync", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || body.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}
