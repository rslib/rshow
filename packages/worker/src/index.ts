import { Hono } from "hono";
import { createAdminApp } from "./admin";
import { instrumentEnv } from "./metrics";
import { handleViewer } from "./viewer";
import type { AppEnv, Env } from "./types";

const viewerApp = new Hono<AppEnv>();
viewerApp.all("*", (c) => handleViewer(c));

const adminApp = createAdminApp();

function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export const REQUIRED_ENV = ["ART_HOST", "ARTD_HOST", "ACCESS_TEAM", "ART_AUD", "ARTD_AUD"] as const;

export function missingEnv(env: Env): string | undefined {
  for (const name of REQUIRED_ENV) {
    const value = env[name];
    if (typeof value !== "string" || value.trim() === "") return name;
  }
  return undefined;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const missing = missingEnv(env);
    if (missing !== undefined) {
      return new Response(`rshow is not configured: missing ${missing}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    const bound = env.DEV_AUTH === "1" ? instrumentEnv(env) : env;
    const url = new URL(request.url);
    // The Host header and the request URL agree in production; checking both keeps
    // local dispatch (miniflare, tests) working when only the URL carries the host.
    const hosts = [bareHost(request.headers.get("host") ?? ""), bareHost(url.host)].filter((host) => host !== "");
    const artHost = bareHost(bound.ART_HOST ?? "");
    const artdHost = bareHost(bound.ARTD_HOST ?? "");

    for (const host of hosts) {
      if (artHost !== "" && host === artHost) return await viewerApp.fetch(request, bound, ctx);
      if (artdHost !== "" && host === artdHost) return await adminApp.fetch(request, bound, ctx);
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
};
