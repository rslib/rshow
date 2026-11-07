export function json(data: unknown, status = 200, init?: HeadersInit): Response {
  const headers = new Headers(init);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

export function jsonError(message: string, status: number): Response {
  return json({ error: message }, status);
}

export function text(body: string, status = 200, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store"
    }
  });
}

export function redirect(location: string, status = 301, cacheControl = "no-store"): Response {
  return new Response(null, { status, headers: { location, "cache-control": cacheControl } });
}

export function notFoundText(): Response {
  return text("Not found", 404);
}
