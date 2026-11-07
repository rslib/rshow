import type { Mode, Scope, ShareRole } from "./constants";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ART_HOST: string;
  ARTD_HOST: string;
  ACCESS_TEAM: string;
  ART_AUD: string;
  ARTD_AUD: string;
  DEV_AUTH?: string;
}

export interface ArtifactRow {
  slug: string;
  title: string;
  owner: string;
  mode: Mode;
  pinned: number | null;
  latest: number | null;
  last_n: number;
  version_gen: number;
  project: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  slug: string;
  title: string;
  description: string;
  owner: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMemberRow {
  project: string;
  email: string;
  role: ShareRole;
}

export interface ProjectMemberInfo {
  email: string;
  role: ShareRole;
}

export interface ProjectAccess {
  slug: string;
  owner: string;
  members: ProjectMemberInfo[];
}

export interface VersionRow {
  slug: string;
  n: number;
  label: string;
  manifest_key: string;
  files: number;
  bytes: number;
  created_by: string;
  created_at: string;
}

export interface ShareRow {
  slug: string;
  email: string;
  role: ShareRole;
}

export interface TokenRow {
  hash: string;
  email: string;
  scope: Scope;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export const IDENTITY_KIND = {
  session: "session",
  bearer: "bearer",
  dev: "dev",
  anonymous: "anonymous"
} as const;
export type IdentityKind = (typeof IDENTITY_KIND)[keyof typeof IDENTITY_KIND];

export interface Identity {
  email: string | null;
  scope: Scope | null;
  kind: IdentityKind;
}

export const ANONYMOUS: Identity = { email: null, scope: null, kind: IDENTITY_KIND.anonymous };

export interface ManifestEntry {
  hash: string;
  size: number;
  type: string;
}

export type Manifest = Record<string, ManifestEntry>;

export type AppEnv = {
  Bindings: Env;
  Variables: {
    identity: Identity;
  };
};
