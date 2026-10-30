import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2025-01-01",
        d1Databases: ["DB"],
        r2Buckets: ["BUCKET"],
        bindings: {
          ART_HOST: "art.example.com",
          ARTD_HOST: "artd.example.com",
          ACCESS_TEAM: "https://your-team.cloudflareaccess.com",
          ART_AUD: "art-audience-tag",
          ARTD_AUD: "artd-audience-tag",
          DEV_AUTH: "1"
        }
      }
    })
  ],
  test: {
    css: true,
    setupFiles: ["./test/setup.ts"],
    // The heavier publish tests (large manifests, many blobs) need more than
    // the default budget.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // workerd reports a rejection as "unhandled" when an async function returns
    // a rejected promise without `await`ing it, even though the caller catches
    // it. `jose`'s `jwtVerify()` propagates errors that way, so the "rejects a
    // token signed with another algorithm" case in test/unit.test.ts surfaces a
    // false positive. Only that known rejection is ignored.
    onUnhandledError(error) {
      return error?.name === "JOSEAlgNotAllowed" ? false : undefined;
    }
  }
});
