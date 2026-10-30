import { describe, expect, it } from "vitest";
import worker, { REQUIRED_ENV, missingEnv } from "../src/index";
import type { Env } from "../src/types";

const BASE: Record<string, string> = {
  ART_HOST: "art.example.com",
  ARTD_HOST: "artd.example.com",
  ACCESS_TEAM: "https://your-team.cloudflareaccess.com",
  ART_AUD: "art-audience-tag",
  ARTD_AUD: "artd-audience-tag"
};

function envWith(overrides: Record<string, unknown>): Env {
  return { ...BASE, ...overrides } as unknown as Env;
}

function context(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

describe("required env", () => {
  it("accepts a complete environment", () => {
    expect(missingEnv(envWith({}))).toBeUndefined();
  });

  it("answers 500 with the missing name for every required var", async () => {
    for (const name of REQUIRED_ENV) {
      const res = await worker.fetch(new Request("https://art.example.com/site/"), envWith({ [name]: "" }), context());
      expect(res.status).toBe(500);
      expect(await res.text()).toBe(`rshow is not configured: missing ${name}`);
    }
  });

  it("never leaks the other values", async () => {
    const res = await worker.fetch(
      new Request("https://artd.example.com/api/me"),
      envWith({ ART_AUD: undefined, RSHOW_SECRET: "do-not-print" }),
      context()
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("rshow is not configured: missing ART_AUD");
  });
});
