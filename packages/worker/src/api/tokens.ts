import type { Hono } from "hono";
import { randomToken, sha256Hex } from "../auth";
import { MAX_TOKEN_NAME_LENGTH, TOKEN_PREFIX, isScope, type Scope } from "../constants";
import { json, jsonError } from "../http";
import type { AppEnv } from "../types";
import { readBody } from "./common";

export function registerTokens(app: Hono<AppEnv>): void {
  app.get("/api/tokens", async (c) => {
    const identity = c.get("identity");
    if (identity.kind === "bearer") return jsonError("tokens cannot manage tokens", 403);
    const email = identity.email as string;
    const result = await c.env.DB.prepare(
      "SELECT hash, name, scope, created_at, last_used_at FROM tokens WHERE email = ?1 ORDER BY created_at DESC, name"
    )
      .bind(email)
      .all<{ hash: string; name: string; scope: Scope; created_at: string; last_used_at: string | null }>();
    const tokens = (result.results ?? []).map((row) => ({
      id: row.hash,
      name: row.name,
      scope: row.scope,
      created_at: row.created_at,
      last_used_at: row.last_used_at
    }));
    return json({ tokens });
  });

  app.post("/api/tokens", async (c) => {
    const identity = c.get("identity");
    if (identity.kind === "bearer") return jsonError("tokens cannot manage tokens", 403);
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const name = typeof body.body.name === "string" ? body.body.name.trim() : "";
    if (name === "" || name.length > MAX_TOKEN_NAME_LENGTH) {
      return jsonError(`name must be 1 to ${MAX_TOKEN_NAME_LENGTH} characters`, 400);
    }
    if (!isScope(body.body.scope)) return jsonError("scope must be publish or full", 400);

    const email = identity.email as string;
    const token = `${TOKEN_PREFIX}${randomToken()}`;
    const hash = await sha256Hex(token);
    const now = new Date().toISOString();
    await c.env.DB.prepare("INSERT INTO tokens (hash, email, scope, name, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)")
      .bind(hash, email, body.body.scope, name, now)
      .run();

    return json({ id: hash, name, scope: body.body.scope, created_at: now, last_used_at: null, token }, 201);
  });

  app.delete("/api/tokens/:id", async (c) => {
    const identity = c.get("identity");
    if (identity.kind === "bearer") return jsonError("tokens cannot manage tokens", 403);
    const email = identity.email as string;
    const result = await c.env.DB.prepare("DELETE FROM tokens WHERE hash = ?1 AND email = ?2")
      .bind(c.req.param("id"), email)
      .run();
    if ((result.meta?.changes ?? 0) === 0) return jsonError("not found", 404);
    return new Response(null, { status: 204 });
  });
}
