import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { sha256Hex, verifyAccessJwt } from "../src/auth";
import { escapeHtml, formatBytes, html, raw } from "../src/html";
import { isValidManifestPath, parseManifest } from "../src/manifest";
import { safeNext } from "../src/viewer";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "art-audience-tag";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
const jwks = createLocalJWKSet({ keys: [jwk] });

async function sign(payload: Record<string, unknown>, options: { aud?: string; iss?: string; exp?: string } = {}) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.iss ?? TEAM)
    .setAudience(options.aud ?? AUD)
    .setExpirationTime(options.exp ?? "1h")
    .sign(privateKey);
}

describe("access JWTs", () => {
  it("accepts a valid token and lowercases the email", async () => {
    const token = await sign({ email: "Person@Example.COM" });
    expect(await verifyAccessJwt(token, { team: TEAM, aud: AUD, jwks })).toBe("person@example.com");
  });

  it("rejects the wrong audience", async () => {
    const token = await sign({ email: "person@example.com" }, { aud: "other-audience" });
    expect(await verifyAccessJwt(token, { team: TEAM, aud: AUD, jwks })).toBeNull();
  });

  it("rejects the wrong issuer", async () => {
    const token = await sign({ email: "person@example.com" }, { iss: "https://evil.example.com" });
    expect(await verifyAccessJwt(token, { team: TEAM, aud: AUD, jwks })).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({ email: "person@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);
    expect(await verifyAccessJwt(token, { team: TEAM, aud: AUD, jwks })).toBeNull();
  });

  it("rejects tokens without an email claim", async () => {
    const token = await sign({ sub: "abc" });
    expect(await verifyAccessJwt(token, { team: TEAM, aud: AUD, jwks })).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyAccessJwt("not-a-jwt", { team: TEAM, aud: AUD, jwks })).toBeNull();
    expect(await verifyAccessJwt("", { team: TEAM, aud: AUD, jwks })).toBeNull();
  });

  it("rejects a token signed with another algorithm", async () => {
    const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
    const token = await new SignJWT({ email: "person@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifyAccessJwt(token, { team: TEAM, aud: AUD, jwks })).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of an empty string", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("safeNext", () => {
  const host = "art.example.com";

  it("keeps same-origin paths", () => {
    expect(safeNext("/a/b?c=1", host)).toBe("/a/b?c=1");
    expect(safeNext("/", host)).toBe("/");
  });

  it("rejects off-site and tricky values", () => {
    expect(safeNext("//evil.com", host)).toBe("/");
    expect(safeNext("/\\evil.com", host)).toBe("/");
    expect(safeNext("https://evil.com", host)).toBe("/");
    expect(safeNext("evil.com", host)).toBe("/");
    expect(safeNext(null, host)).toBe("/");
    expect(safeNext("", host)).toBe("/");
  });

  it("rejects control characters and whitespace", () => {
    for (const raw of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/ /evil.com", "/\u0000/evil.com", "/\u007f/evil.com"]) {
      expect(safeNext(raw, host)).toBe("/");
    }
    expect(safeNext("///evil.com", host)).toBe("/");
  });
});

describe("manifest paths", () => {
  it("accepts plain paths", () => {
    expect(isValidManifestPath("index.html")).toBe(true);
    expect(isValidManifestPath("a/b/c.css")).toBe(true);
    expect(isValidManifestPath("a/..b/c")).toBe(true);
  });

  it("rejects traversal and odd segments", () => {
    for (const path of ["../x", "/x", "a//b", "a\\b", "", "a/", "a/./b", "a/../b", "."]) {
      expect(isValidManifestPath(path)).toBe(false);
    }
  });

  it("parses only well formed manifests", () => {
    const good = { "index.html": { hash: "a".repeat(64), size: 1, type: "text/html" } };
    expect(parseManifest(good)).not.toBeNull();
    expect(parseManifest({ "../x": { hash: "a".repeat(64), size: 1, type: "text/html" } })).toBeNull();
    expect(parseManifest({ "index.html": { hash: "nope", size: 1, type: "text/html" } })).toBeNull();
    expect(parseManifest([])).toBeNull();
  });
});

describe("html helpers", () => {
  it("escapes interpolated values", () => {
    const out = html`<p>${'<script>alert("x")</script>'}</p>`;
    expect(out.value).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  });

  it("does not double escape raw html", () => {
    expect(html`<div>${raw("<b>hi</b>")}</div>`.value).toBe("<div><b>hi</b></div>");
  });

  it("escapes quotes and ampersands", () => {
    expect(escapeHtml(`a&b"c'd<e`)).toBe("a&amp;b&quot;c&#39;d&lt;e");
  });

  it("formats bytes", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
  });
});
