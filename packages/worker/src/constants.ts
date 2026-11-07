import { MODE, SCOPE, SHARE_ROLE } from "rshow-shared";
import type { Mode, Scope, ShareRole } from "rshow-shared";

export {
  DATA_KEY_PATTERN,
  EMAIL_PATTERN,
  MAX_BLOB_BYTES,
  MAX_DATA_BYTES,
  MAX_DATA_KEYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_MISSING_HASHES,
  MAX_SKETCH_DATA_BYTES,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  MAX_VERSION_BYTES,
  MAX_VERSION_FILES,
  MODE,
  PROJECT_SEGMENT,
  ROLE,
  SCOPE,
  SHARE_ROLE,
  SKETCH_DATA_KEY_PREFIX,
  SLUG_PATTERN,
  TAG_PATTERN,
  THEMES_SEGMENT,
  THEME_JSON_PATTERN,
  THEME_LATEST_PATTERN,
  THEME_NAME_PATTERN,
  THEME_PREFIX,
  THEME_VERSION_PATTERN,
  TOKEN_PATTERN,
  TOKEN_PREFIX
} from "rshow-shared";
export type {
  Artifact,
  Me,
  Mode,
  Project,
  Role,
  Scope,
  Share,
  ShareRole,
  ThemeInfo,
  Version,
  VersionDetail
} from "rshow-shared";

export const HASH_PATTERN = /^[a-f0-9]{64}$/;
export const DATA_BLOB_PREFIX = "data/";
export const DATA_BLOB_SUFFIX = ".json";
export const MAX_D1_BOUND_PARAMS = 90;
export const MAX_BLOB_CACHE_BYTES = 50 * 1024 * 1024;
export const MAX_BUFFERED_BLOB_BYTES = 1024 * 1024;
export const MAX_PATH_LENGTH = 1024;
export const MAX_TOKEN_NAME_LENGTH = 64;
export const TOKEN_BYTES = 32;
export const TOKEN_LAST_USED_INTERVAL_MS = 60 * 60 * 1000;

const MODE_VALUES: readonly string[] = Object.values(MODE);
const SHARE_ROLE_VALUES: readonly string[] = Object.values(SHARE_ROLE);
const SCOPE_VALUES: readonly string[] = Object.values(SCOPE);

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && MODE_VALUES.includes(value);
}

export function isShareRole(value: unknown): value is ShareRole {
  return typeof value === "string" && SHARE_ROLE_VALUES.includes(value);
}

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && SCOPE_VALUES.includes(value);
}
