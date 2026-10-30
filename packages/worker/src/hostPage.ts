import { escapeHtml } from "./html";
import { redirect } from "./http";

// The minimal inline style used by the host error pages, also used as the group
// page fallback when the default theme is not published.
export const MINIMAL_STYLE =
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F6F3;color:#16181D;font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif}main{max-width:32rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#5A5E66}code{font-family:"IBM Plex Mono",ui-monospace,monospace;color:#16181D}';

export function hostErrorPage(status: number, heading: string, message: string): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>${MINIMAL_STYLE}</style>
</head>
<body><main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

export function notFoundPage(message = "This page does not exist or is not published."): Response {
  return hostErrorPage(404, "Not found", message);
}

export function forbiddenPage(email: string): Response {
  return hostErrorPage(403, "No access", `You are signed in as ${email}, which cannot view this artifact.`);
}

export function loginRedirect(pathname: string, search: string): Response {
  return redirect(`/_auth/login?next=${encodeURIComponent(pathname + search)}`, 302);
}
