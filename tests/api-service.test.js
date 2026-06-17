import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminRequest,
  chatRequest,
  fetchUpstreamModels,
  getAdminSession,
  listPublicModels,
  loginAdmin,
  logoutAdmin
} from "../src/services/api.js";

describe("api services", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses cookie credentials for admin requests", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "ch_1" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const body = await adminRequest("/api/admin/channels");

    expect(body).toEqual({ data: [{ id: "ch_1" }] });
    expect(fetch).toHaveBeenCalledWith("/api/admin/channels", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });
  });

  it("keeps custom admin headers and body", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await adminRequest("/api/admin/users", {
      method: "POST",
      headers: { "X-Trace-Id": "trace-1" },
      body: JSON.stringify({ name: "demo" })
    });

    expect(fetch).toHaveBeenCalledWith("/api/admin/users", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ name: "demo" }),
      headers: {
        "Content-Type": "application/json",
        "X-Trace-Id": "trace-1"
      }
    });
  });

  it("creates admin sessions with the entered token", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await loginAdmin("admin-token");

    expect(fetch).toHaveBeenCalledWith("/api/admin/session", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ token: "admin-token" }),
      headers: {
        "Content-Type": "application/json"
      }
    });
  });

  it("checks and clears admin sessions with cookies", async () => {
    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    await getAdminSession();
    await logoutAdmin();

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/admin/session", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/admin/session", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });
  });

  it("throws parsed admin errors", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "Invalid admin token." }
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(adminRequest("/api/admin/channels")).rejects.toThrow("Invalid admin token.");
  });

  it("loads public models with json accept header", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const body = await listPublicModels();

    expect(body.data[0].id).toBe("gpt-4o-mini");
    expect(fetch).toHaveBeenCalledWith("/v1/models", {
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("posts channel ids when fetching upstream models", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await fetchUpstreamModels(["ch_1", "ch_2"]);

    expect(fetch).toHaveBeenCalledWith("/api/admin/models/fetch", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ channel_ids: ["ch_1", "ch_2"] }),
      headers: {
        "Content-Type": "application/json"
      }
    });
  });

  it("uses event-stream accept header for streaming chat", async () => {
    fetch.mockResolvedValueOnce(new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));

    const response = await chatRequest({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    });

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      }
    }));
  });

  it("throws parsed chat errors", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "No enabled channel is available." }
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(chatRequest({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
      stream: false
    })).rejects.toThrow("No enabled channel is available.");
  });
});
