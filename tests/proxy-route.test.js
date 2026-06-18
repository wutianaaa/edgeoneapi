import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../edge-functions/p/[[default]].js";

describe("/p proxy route", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards the original request to the target url without processing", async () => {
    fetch.mockResolvedValueOnce(new Response("upstream-ok", {
      status: 201,
      headers: {
        "content-type": "text/plain",
        "x-upstream": "yes"
      }
    }));

    const response = await onRequest({
      request: new Request("https://ai.xixiya.top/p/https://sub2api.luciferai.cc/v1/chat/completions?foo=bar", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-key"
        },
        body: JSON.stringify({ hello: "world" })
      })
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [forwardedUrl, forwardedInit] = fetch.mock.calls[0];
    expect(forwardedUrl).toBe("https://sub2api.luciferai.cc/v1/chat/completions?foo=bar");
    expect(forwardedInit.method).toBe("POST");
    expect(forwardedInit.headers.get("content-type")).toBe("application/json");
    expect(forwardedInit.headers.get("authorization")).toBe("Bearer test-key");
    const forwardedBody = await new Response(forwardedInit.body).text();
    expect(forwardedBody).toBe(JSON.stringify({ hello: "world" }));

    expect(response.status).toBe(201);
    await expect(response.text()).resolves.toBe("upstream-ok");
    expect(response.headers.get("x-upstream")).toBe("yes");
  });

  it("returns 400 when the target url is missing or invalid", async () => {
    const missing = await onRequest({
      request: new Request("https://ai.xixiya.top/p/")
    });
    expect(missing.status).toBe(400);

    const invalid = await onRequest({
      request: new Request("https://ai.xixiya.top/p/not-a-url")
    });
    expect(invalid.status).toBe(400);
  });
});
