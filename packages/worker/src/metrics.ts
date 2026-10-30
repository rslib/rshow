import type { Env } from "./types";

export interface CallCounts {
  d1: number;
  r2: number;
}

const COUNTS: CallCounts = { d1: 0, r2: 0 };
const D1_DATABASE_METHODS = new Set(["prepare", "batch", "exec", "dump"]);
const D1_SESSION_METHODS = new Set(["prepare", "batch"]);
const R2_METHODS = new Set(["get", "head", "put", "delete", "list"]);

export function callCounts(): CallCounts {
  return { d1: COUNTS.d1, r2: COUNTS.r2 };
}

export function resetCallCounts(): void {
  COUNTS.d1 = 0;
  COUNTS.r2 = 0;
}

type ResultWrapper = (name: string, result: unknown) => unknown;

function wrapMethods<T extends object>(
  target: T,
  methods: Set<string>,
  bump: () => void,
  wrapResult?: ResultWrapper
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") return value;
      const name = String(prop);
      return (...args: unknown[]) => {
        if (methods.has(name)) bump();
        const result = Reflect.apply(value, obj, args);
        return wrapResult ? wrapResult(name, result) : result;
      };
    }
  });
}

function instrumentSession(session: D1DatabaseSession): D1DatabaseSession {
  return wrapMethods(session, D1_SESSION_METHODS, () => {
    COUNTS.d1 += 1;
  });
}

// Only dev and test builds pay for the counting proxies.
export function instrumentEnv(env: Env): Env {
  const db = wrapMethods(
    env.DB,
    D1_DATABASE_METHODS,
    () => {
      COUNTS.d1 += 1;
    },
    (name, result) => (name === "withSession" ? instrumentSession(result as D1DatabaseSession) : result)
  );
  const bucket = wrapMethods(env.BUCKET, R2_METHODS, () => {
    COUNTS.r2 += 1;
  });
  return { ...env, DB: db, BUCKET: bucket };
}
