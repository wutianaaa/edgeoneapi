async function onRequest(context) {
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

  const proxyRequest = new Request(targetUrl, request);
  return fetch(proxyRequest);
}

export { onRequest };
export default onRequest;
