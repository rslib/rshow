import type { Env as WorkerEnv } from "../src/types";

// `@cloudflare/vitest-plugin` types `cloudflare:test`'s `env` as
// `Cloudflare.Env`, so the Worker bindings are declared by merging into that
// namespace (the old `ProvidedEnv` augmentation is gone).
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
