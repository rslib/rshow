import type { Hono } from "hono";
import { SCOPE } from "../constants";
import { json, jsonError } from "../http";
import type { AppEnv } from "../types";
import { registerArtifactCreate, registerArtifactItem, registerArtifactList } from "./artifacts";
import { registerBlobs } from "./blobs";
import { registerProjects } from "./projects";
import { registerTags } from "./tags";
import { registerTokens } from "./tokens";
import { registerVersions } from "./versions";

export { storeVersion } from "./versions";

export function registerApi(app: Hono<AppEnv>): void {
  app.get("/api/me", (c) => {
    const identity = c.get("identity");
    return json({ email: identity.email, scope: identity.scope ?? SCOPE.full });
  });

  registerArtifactList(app);
  registerTags(app);
  registerArtifactCreate(app);
  registerArtifactItem(app);
  registerBlobs(app);
  registerVersions(app);
  registerProjects(app);
  registerTokens(app);

  app.all("/api/*", () => jsonError("not found", 404));

  app.all("/api", () => jsonError("not found", 404));
}
