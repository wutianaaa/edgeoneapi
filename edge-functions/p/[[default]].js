async function onRequest(context) {
  try {
    const { request } = context;
    const url = new URL(request.url);
    const prefix = "/p/";

    if (!url.pathname.startsWith(prefix)) {
      return new Response("Not found.", { status: 404 });
    }

    const target = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!target) {
      return new Response("Missing proxy target.", { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response("Invalid proxy target.", { status: 400 });
    }

    if (url.search) {
      targetUrl.search = targetUrl.search ? `${targetUrl.search}&${url.search.slice(1)}` : url.search;
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");

    const init = {
      method: request.method,
      headers,
      redirect: "manual"
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    return await fetch(targetUrl.toString(), init);
  } catch (cause) {
    return new Response(cause?.stack || cause?.message || "Proxy failed.", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
}

export { onRequest };
export default onRequest;
