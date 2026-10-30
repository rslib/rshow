import type { Hono } from "hono";
import { APP_CSS, APP_JS, MODE_JS } from "./static.generated";
import type { AppEnv } from "./types";

const CACHE_CONTROL = "public, max-age=3600";

export function registerStatic(app: Hono<AppEnv>): void {
  app.get("/static/app.css", () =>
    new Response(APP_CSS, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": CACHE_CONTROL }
    })
  );
  app.get("/static/app.js", () =>
    new Response(APP_JS, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": CACHE_CONTROL }
    })
  );
  app.get("/static/mode.js", () =>
    new Response(MODE_JS, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": CACHE_CONTROL }
    })
  );
}
