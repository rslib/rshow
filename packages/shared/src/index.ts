export const MODE = { private: "private", people: "people", public: "public" } as const;
export type Mode = (typeof MODE)[keyof typeof MODE];

export const ROLE = { owner: "owner", editor: "editor", viewer: "viewer" } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

export const SHARE_ROLE = { viewer: "viewer", editor: "editor" } as const;
export type ShareRole = (typeof SHARE_ROLE)[keyof typeof SHARE_ROLE];

export const SCOPE = { publish: "publish", full: "full" } as const;
export type Scope = (typeof SCOPE)[keyof typeof SCOPE];

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const THEME_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;
export const THEME_VERSION_PATTERN = /^([a-z0-9-]{1,40})@([0-9]{1,9})$/;
export const THEME_JSON_PATTERN = /^([a-z0-9-]{1,40})\.json$/;
export const DATA_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TOKEN_PATTERN = /^rsh_[A-Za-z0-9_-]{43}$/;
export const TOKEN_PREFIX = "rsh_";

export const THEMES_SEGMENT = "_themes";
export const THEME_PREFIX = "theme-";
export const PROJECT_SEGMENT = "_p";
// Keys with this prefix may hold up to MAX_SKETCH_DATA_BYTES; values above
// MAX_DATA_BYTES are stored in R2 instead of D1.
export const SKETCH_DATA_KEY_PREFIX = "sketch-";

export const MAX_BLOB_BYTES = 25 * 1024 * 1024;
export const MAX_VERSION_BYTES = 100 * 1024 * 1024;
export const MAX_VERSION_FILES = 2000;
export const MAX_DATA_BYTES = 64 * 1024;
export const MAX_SKETCH_DATA_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_KEYS = 500;
export const MAX_TAGS = 10;
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_MISSING_HASHES = 1000;

export type Artifact = {
  slug: string;
  title: string;
  owner: string;
  mode: Mode;
  pinned: number | null;
  latest: number | null;
  served: number | null;
  project: string | null;
  tags: string[];
  updated_at: string;
  role: Role;
  url: string;
};

export type Version = {
  n: number;
  label: string;
  created_by: string;
  created_at: string;
  files: number;
  bytes: number;
  url: string;
};

export type ManifestFile = { hash: string; size: number; type: string };

// `files` is the manifest itself, not the count that Version carries.
export type VersionDetail = Omit<Version, 'files'> & { files: Record<string, ManifestFile> };

export type Share = { email: string; role: ShareRole };

export type Project = {
  slug: string;
  title: string;
  description: string;
  owner: string;
  role: Role;
  artifacts: number;
  updated_at: string;
  url: string;
};

export type Me = { email: string; scope: Scope };

export type ThemeInfo = { name: string; version: number; url: string };
