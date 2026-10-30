import { MODE, ROLE, SCOPE, type Mode, type Role, type Scope, type ShareRole } from "./constants";

export interface AccessInfo {
  owner: string;
  mode: Mode;
}

export interface ShareInfo {
  email: string;
  role: ShareRole;
}

export interface ProjectInfo {
  owner: string;
  members: readonly ShareInfo[];
}

export interface Actor {
  email: string | null;
  scope: Scope | null;
}

const SHARE_ROLE_RANK: Record<ShareRole, number> = {
  viewer: 1,
  editor: 2
};

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function maxShareRole(left: ShareRole | null, right: ShareRole | null): ShareRole | null {
  if (left === null) return right;
  if (right === null) return left;
  return SHARE_ROLE_RANK[left] >= SHARE_ROLE_RANK[right] ? left : right;
}

export function shareRoleFor(info: AccessInfo, email: string | null, shares: readonly ShareInfo[]): ShareRole | null {
  const target = normalizeEmail(email);
  if (target === "") return null;
  for (const share of shares) {
    if (normalizeEmail(share.email) === target) return share.role;
  }
  return null;
}

// The project owner counts as an editor on the project's artifacts, never as owner.
export function projectShareRoleFor(project: ProjectInfo | null, email: string | null): ShareRole | null {
  if (!project) return null;
  const target = normalizeEmail(email);
  if (target === "") return null;
  if (normalizeEmail(project.owner) === target) return "editor";
  for (const member of project.members) {
    if (normalizeEmail(member.email) === target) return member.role;
  }
  return null;
}

// The caller's own role on the project itself (owner/editor/viewer).
export function projectRole(project: ProjectInfo | null, email: string | null): Role | null {
  if (!project) return null;
  const target = normalizeEmail(email);
  if (target === "") return null;
  if (normalizeEmail(project.owner) === target) return ROLE.owner;
  const share = projectShareRoleFor(project, target);
  if (share === "editor") return ROLE.editor;
  if (share === "viewer") return ROLE.viewer;
  return null;
}

export function roleFor(
  info: AccessInfo,
  email: string | null,
  shares: readonly ShareInfo[],
  project: ProjectInfo | null = null
): Role | null {
  const target = normalizeEmail(email);
  if (target === "") return null;
  if (normalizeEmail(info.owner) === target) return ROLE.owner;
  const share = maxShareRole(shareRoleFor(info, target, shares), projectShareRoleFor(project, target));
  if (share === "editor") return ROLE.editor;
  if (share === "viewer") return ROLE.viewer;
  return null;
}

export function canView(
  info: AccessInfo,
  email: string | null,
  shares: readonly ShareInfo[],
  project: ProjectInfo | null = null
): boolean {
  if (info.mode === MODE.public) return true;
  const role = roleFor(info, email, shares, project);
  if (role === ROLE.owner) return true;
  if (info.mode === MODE.people) return role === ROLE.editor || role === ROLE.viewer;
  return role === ROLE.editor;
}

export function isPublishScope(scope: Scope | null): boolean {
  return scope === null || scope === SCOPE.publish || scope === SCOPE.full;
}

export function canPublish(
  info: AccessInfo,
  shares: readonly ShareInfo[],
  actor: Actor,
  project: ProjectInfo | null = null
): boolean {
  if (!isPublishScope(actor.scope)) return false;
  const role = roleFor(info, actor.email, shares, project);
  return role === ROLE.owner || role === ROLE.editor;
}

export function canManage(
  info: AccessInfo,
  shares: readonly ShareInfo[],
  actor: Actor,
  project: ProjectInfo | null = null
): boolean {
  if (actor.scope !== null && actor.scope !== SCOPE.full) return false;
  return roleFor(info, actor.email, shares, project) === ROLE.owner;
}

// A project owner may change, share and delete the project with a session or a full token.
export function canManageProject(project: ProjectInfo | null, actor: Actor): boolean {
  if (actor.scope !== null && actor.scope !== SCOPE.full) return false;
  return projectRole(project, actor.email) === ROLE.owner;
}

// Owner or editor of a project may put an artifact they own into it.
export function canEditProject(project: ProjectInfo | null, email: string | null): boolean {
  const role = projectRole(project, email);
  return role === ROLE.owner || role === ROLE.editor;
}

export function canCreate(actor: Actor): boolean {
  return normalizeEmail(actor.email) !== "";
}
