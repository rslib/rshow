import { env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { clearResponseCache } from "../src/cache";
import { resetCallCounts } from "../src/metrics";
import blobsMigration from "../migrations/0002_blobs.sql?raw";
import pageDataBlobMigration from "../migrations/0004_page_data_blob.sql?raw";
import versionCountersMigration from "../migrations/0005_version_counters.sql?raw";
import retiredSlugsMigration from "../migrations/0006_retired_slugs.sql?raw";
import projectsMigration from "../migrations/0003_projects.sql?raw";
import initMigration from "../migrations/0001_init.sql?raw";

// D1 exec() splits input by line, so each statement is flattened to one line here.
// `--` comment lines are dropped: on their own they are not a statement.
function statementsOf(migration: string): string[] {
  const withoutComments = migration
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);
}

const STATEMENTS = [
  ...statementsOf(initMigration),
  ...statementsOf(blobsMigration),
  ...statementsOf(projectsMigration),
  ...statementsOf(pageDataBlobMigration),
  ...statementsOf(versionCountersMigration),
  ...statementsOf(retiredSlugsMigration)
];

const DROPS = [
  "DROP TABLE IF EXISTS page_data",
  "DROP TABLE IF EXISTS tokens",
  "DROP TABLE IF EXISTS artifact_tags",
  "DROP TABLE IF EXISTS shares",
  "DROP TABLE IF EXISTS versions",
  "DROP TABLE IF EXISTS artifacts",
  "DROP TABLE IF EXISTS retired_slugs",
  "DROP TABLE IF EXISTS project_members",
  "DROP TABLE IF EXISTS projects",
  "DROP TABLE IF EXISTS blobs"
];

beforeEach(async () => {
  await clearResponseCache();
  resetCallCounts();
  for (const drop of DROPS) await env.DB.exec(drop);
  for (const statement of STATEMENTS) await env.DB.exec(statement);
});
