import type { Hono } from "hono";
import { listArtifactsFor, tagCountsForSlugs } from "../db";
import { json } from "../http";
import type { AppEnv } from "../types";

export function registerTags(app: Hono<AppEnv>): void {
  app.get("/api/tags", async (c) => {
    const email = c.get("identity").email as string;
    const rows = await listArtifactsFor(c.env, email);
    const counts = await tagCountsForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const tags = [...counts.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([tag, count]) => ({ tag, count }));
    return json({ tags });
  });
}
