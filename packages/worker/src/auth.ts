import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { SCOPE, TOKEN_LAST_USED_INTERVAL_MS, TOKEN_PATTERN } from "./constants";
import { ANONYMOUS, IDENTITY_KIND, type Env, type Identity, type TokenRow } from "./types";

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function remoteJwks(team: string): JWTVerifyGetKey {
  const cached = jwksCache.get(team);
  if (cached) return cached;
  const set = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  jwksCache.set(team, set);
  return set;
}

export interface VerifyOptions {
  team: string;
  aud: string;
  jwks?: JWTVerifyGetKey;
}

export async function verifyAccessJwt(token: string, options: VerifyOptions): Promise<string | null> {
  if (!token || !options.team || !options.aud) return null;
  try {
    const jwks = options.jwks ?? remoteJwks(options.team);
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: options.team,
      audience: options.aud
    });
    const email = payload["email"];
    if (typeof email !== "string") return null;
    return normalizeIdentityEmail(email);
  } catch {
    return null;
  }
}

export function normalizeIdentityEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (value === "" || value.includes(" ") || !value.includes("@")) return null;
  return value;
}

function cookieValue(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    return value === "" ? null : value;
  }
  return null;
}

export function devEmail(env: Env, headers: Headers): string | null {
  if (env.DEV_AUTH !== "1") return null;
  const value = headers.get("x-dev-email");
  if (!value) return null;
  return normalizeIdentityEmail(value);
}

export async function sessionEmail(env: Env, isAdminHost: boolean, headers: Headers): Promise<string | null> {
  const team = (env.ACCESS_TEAM ?? "").replace(/\/+$/, "");
  const aud = isAdminHost ? env.ARTD_AUD : env.ART_AUD;
  if (!team || !aud) return null;
  let token: string | null = null;
  if (isAdminHost) {
    const assertion = headers.get("cf-access-jwt-assertion");
    if (assertion && assertion.trim() !== "") token = assertion.trim();
  }
  if (!token) token = cookieValue(headers, "CF_Authorization");
  if (!token) return null;
  return verifyAccessJwt(token, { team, aud });
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  let bytes: BufferSource;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (!raw) return null;
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(raw.trim());
  if (!match) return null;
  return match[1];
}

export async function bearerIdentity(env: Env, headers: Headers): Promise<Identity | null> {
  const token = bearerToken(headers);
  if (!token) return null;
  if (!TOKEN_PATTERN.test(token)) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT hash, email, scope, name, created_at, last_used_at FROM tokens WHERE hash = ?1")
    .bind(hash)
    .first<TokenRow>();
  if (!row) return null;
  const email = normalizeIdentityEmail(row.email);
  if (!email) return null;
  const now = Date.now();
  const lastUsed = row.last_used_at === null ? null : Date.parse(row.last_used_at);
  if (lastUsed === null || !Number.isFinite(lastUsed) || now - lastUsed > TOKEN_LAST_USED_INTERVAL_MS) {
    await env.DB.prepare("UPDATE tokens SET last_used_at = ?2 WHERE hash = ?1")
      .bind(hash, new Date(now).toISOString())
      .run();
  }
  return { email, scope: row.scope, kind: IDENTITY_KIND.bearer };
}

export async function resolveAdminIdentity(env: Env, headers: Headers): Promise<Identity> {
  const dev = devEmail(env, headers);
  if (dev) return { email: dev, scope: SCOPE.full, kind: IDENTITY_KIND.dev };
  const bearer = await bearerIdentity(env, headers);
  if (bearer) return bearer;
  const email = await sessionEmail(env, true, headers);
  if (email) return { email, scope: SCOPE.full, kind: IDENTITY_KIND.session };
  return ANONYMOUS;
}

export async function resolveViewerIdentity(env: Env, headers: Headers): Promise<Identity> {
  const dev = devEmail(env, headers);
  if (dev) return { email: dev, scope: SCOPE.full, kind: IDENTITY_KIND.dev };
  const email = await sessionEmail(env, false, headers);
  if (email) return { email, scope: SCOPE.full, kind: IDENTITY_KIND.session };
  return ANONYMOUS;
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
