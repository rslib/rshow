import { describe, expect, it } from "vitest";
import {
  canCreate,
  canEditProject,
  canManage,
  canManageProject,
  canPublish,
  canView,
  maxShareRole,
  normalizeEmail,
  projectRole,
  projectShareRoleFor,
  roleFor,
  shareRoleFor,
  type ProjectInfo,
  type ShareInfo
} from "../src/authz";
import { MODE, ROLE, SCOPE, type Mode, type Scope } from "../src/constants";

const owner = "Owner@Example.com";
const editor = "editor@example.com";
const viewer = "viewer@example.com";
const stranger = "stranger@example.com";

const shares = [
  { email: editor, role: "editor" as const },
  { email: viewer, role: "viewer" as const }
];

interface Case {
  name: string;
  mode: Mode;
  email: string | null;
  scope: Scope | null;
  view: boolean;
  publish: boolean;
  manage: boolean;
}

const cases: Case[] = [];

for (const mode of [MODE.private, MODE.people, MODE.public] as Mode[]) {
  const privateMode = mode === MODE.private;
  const publicMode = mode === MODE.public;
  const peopleMode = mode === MODE.people;

  cases.push({
    name: `${mode}: owner`,
    mode,
    email: owner,
    scope: null,
    view: true,
    publish: true,
    manage: true
  });
  cases.push({
    name: `${mode}: editor`,
    mode,
    email: editor,
    scope: null,
    view: true,
    publish: true,
    manage: false
  });
  cases.push({
    name: `${mode}: viewer`,
    mode,
    email: viewer,
    scope: null,
    view: !privateMode,
    publish: false,
    manage: false
  });
  cases.push({
    name: `${mode}: signed-in stranger`,
    mode,
    email: stranger,
    scope: null,
    view: publicMode,
    publish: false,
    manage: false
  });
  cases.push({
    name: `${mode}: anonymous`,
    mode,
    email: null,
    scope: null,
    view: publicMode,
    publish: false,
    manage: false
  });
  cases.push({
    name: `${mode}: owner with publish token`,
    mode,
    email: owner,
    scope: SCOPE.publish,
    view: true,
    publish: true,
    manage: false
  });
  cases.push({
    name: `${mode}: owner with full token`,
    mode,
    email: owner,
    scope: SCOPE.full,
    view: true,
    publish: true,
    manage: true
  });
  cases.push({
    name: `${mode}: editor with publish token`,
    mode,
    email: editor,
    scope: SCOPE.publish,
    view: true,
    publish: true,
    manage: false
  });
  cases.push({
    name: `${mode}: viewer with full token`,
    mode,
    email: viewer,
    scope: SCOPE.full,
    view: !privateMode,
    publish: false,
    manage: false
  });
  if (peopleMode || publicMode) {
    cases.push({
      name: `${mode}: stranger with full token`,
      mode,
      email: stranger,
      scope: SCOPE.full,
      view: publicMode,
      publish: false,
      manage: false
    });
  }
}

describe("authz matrix", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const info = { owner, mode: testCase.mode };
      const actor = { email: testCase.email, scope: testCase.scope };
      expect(canView(info, actor.email, shares)).toBe(testCase.view);
      expect(canPublish(info, shares, actor)).toBe(testCase.publish);
      expect(canManage(info, shares, actor)).toBe(testCase.manage);
    });
  }
});

describe("role", () => {
  it("owner wins over share", () => {
    expect(roleFor({ owner, mode: MODE.private }, owner.toLowerCase(), shares)).toBe(ROLE.owner);
    expect(roleFor({ owner, mode: MODE.private }, null, shares)).toBeNull();
  });

  it("returns share role", () => {
    expect(roleFor({ owner, mode: MODE.private }, editor, shares)).toBe(ROLE.editor);
    expect(roleFor({ owner, mode: MODE.private }, viewer, shares)).toBe(ROLE.viewer);
    expect(roleFor({ owner, mode: MODE.private }, stranger, shares)).toBeNull();
    expect(shareRoleFor({ owner, mode: MODE.private }, viewer.toUpperCase(), shares)).toBe("viewer");
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normalizeEmail(null)).toBe("");
  });
});

describe("canCreate", () => {
  it("allows any authenticated actor", () => {
    expect(canCreate({ email: stranger, scope: null })).toBe(true);
    expect(canCreate({ email: stranger, scope: SCOPE.publish })).toBe(true);
    expect(canCreate({ email: null, scope: null })).toBe(false);
  });
});

describe("project matrix", () => {
  const artifactOwner = "artifact-owner@example.com";
  const projectOwner = "project-owner@example.com";
  const me = "me@example.com";

  type DirectRole = "editor" | "viewer" | "none";
  type ProjectSlot = "owner" | "editor" | "viewer" | "none";
  type Action = "view" | "publish" | "manage" | "manageProject" | "editProject";

  const modes: Mode[] = [MODE.private, MODE.people, MODE.public];
  const directRoles: DirectRole[] = ["editor", "viewer", "none"];
  const projectSlots: ProjectSlot[] = ["owner", "editor", "viewer", "none"];

  function sharesFor(direct: DirectRole): ShareInfo[] {
    return direct === "none" ? [] : [{ email: me, role: direct }];
  }

  function projectFor(slot: ProjectSlot): ProjectInfo | null {
    if (slot === "none") return null;
    const members: ShareInfo[] = slot === "owner" ? [] : [{ email: me, role: slot }];
    return { owner: slot === "owner" ? me : projectOwner, members };
  }

  // The documented rule: the effective role is the higher of the direct share and
  // the project role, and a project owner counts as an editor on its artifacts.
  function expected(mode: Mode, direct: DirectRole, slot: ProjectSlot, action: Action): boolean {
    const rank = (role: DirectRole | ProjectSlot): number => {
      if (role === "owner") return 3;
      if (role === "editor") return 2;
      if (role === "viewer") return 1;
      return 0;
    };
    const projectShare = slot === "owner" ? 2 : rank(slot);
    const effective = Math.max(rank(direct), projectShare);
    // `me` never owns the artifact in this matrix.
    if (action === "manageProject") return slot === "owner";
    if (action === "editProject") return projectShare >= 2;
    if (action === "publish") return effective >= 2;
    if (action === "manage") return false;
    if (mode === MODE.public) return true;
    if (mode === MODE.people) return effective >= 1;
    return effective >= 2;
  }

  const actions: Action[] = ["view", "publish", "manage", "manageProject", "editProject"];

  for (const mode of modes) {
    for (const direct of directRoles) {
      for (const slot of projectSlots) {
        it(`${mode} / direct ${direct} / project ${slot}`, () => {
          const info = { owner: artifactOwner, mode };
          const shares = sharesFor(direct);
          const project = projectFor(slot);
          const actor = { email: me, scope: null };

          for (const action of actions) {
            const want = expected(mode, direct, slot, action);
            const label = `${mode}/${direct}/${slot}/${action}`;
            if (action === "view") expect(canView(info, actor.email, shares, project), label).toBe(want);
            if (action === "publish") expect(canPublish(info, shares, actor, project), label).toBe(want);
            if (action === "manage") expect(canManage(info, shares, actor, project), label).toBe(want);
            if (action === "manageProject") expect(canManageProject(project, actor), label).toBe(want);
            if (action === "editProject") expect(canEditProject(project, actor.email), label).toBe(want);
          }
        });
      }
    }
  }

  it("spot checks the documented outcomes", () => {
    const people = { owner: artifactOwner, mode: MODE.people };
    const team = { owner: projectOwner, members: [{ email: me, role: "viewer" as const }] };
    expect(canView(people, me, [], team)).toBe(true);
    expect(canPublish(people, [], { email: me, scope: null }, team)).toBe(false);

    const privateInfo = { owner: artifactOwner, mode: MODE.private };
    expect(canView(privateInfo, me, [], team)).toBe(false);
    expect(canView(privateInfo, me, [{ email: me, role: "editor" }], team)).toBe(true);

    const owned = { owner: me, members: [] };
    expect(roleFor(people, me, [], owned)).toBe(ROLE.editor);
    expect(canView(privateInfo, me, [], owned)).toBe(true);
    expect(canPublish(privateInfo, [], { email: me, scope: null }, owned)).toBe(true);
    expect(canManage(privateInfo, [], { email: me, scope: SCOPE.full }, owned)).toBe(false);
    expect(canManageProject(owned, { email: me, scope: null })).toBe(true);
    expect(canManageProject(owned, { email: me, scope: SCOPE.publish })).toBe(false);
    expect(canManageProject(owned, { email: me, scope: SCOPE.full })).toBe(true);
    expect(canManageProject(owned, { email: stranger, scope: null })).toBe(false);
  });

  it("takes the higher role and never lets the project owner own the artifact", () => {
    const info = { owner: artifactOwner, mode: MODE.private };
    const both = { owner: projectOwner, members: [{ email: me, role: "editor" as const }] };
    expect(roleFor(info, me, [{ email: me, role: "viewer" }], both)).toBe(ROLE.editor);
    expect(roleFor(info, me, [{ email: me, role: "editor" }], { owner: projectOwner, members: [{ email: me, role: "viewer" }] })).toBe(
      ROLE.editor
    );
    expect(roleFor(info, me, [], { owner: projectOwner, members: [{ email: me, role: "viewer" }] })).toBe(ROLE.viewer);
    expect(roleFor(info, me, [], { owner: artifactOwner, members: [] })).toBeNull();
    expect(roleFor(info, artifactOwner.toUpperCase(), [], null)).toBe(ROLE.owner);
    expect(roleFor(info, projectOwner, [], { owner: projectOwner, members: [] })).toBe(ROLE.editor);
    expect(projectRole({ owner: projectOwner, members: [{ email: me, role: "viewer" }] }, me)).toBe(ROLE.viewer);
    expect(projectRole({ owner: projectOwner, members: [] }, me)).toBeNull();
    expect(projectShareRoleFor(null, me)).toBeNull();
    expect(maxShareRole("viewer", "editor")).toBe("editor");
    expect(maxShareRole(null, null)).toBeNull();
  });

  it("keeps the matrix functions pure", () => {
    const info = { owner: artifactOwner, mode: MODE.private };
    const shares: ShareInfo[] = [{ email: me, role: "viewer" }];
    const project: ProjectInfo = { owner: projectOwner, members: [{ email: me, role: "editor" }] };
    const before = JSON.stringify({ info, shares, project });
    canView(info, me, shares, project);
    canPublish(info, shares, { email: me, scope: SCOPE.publish }, project);
    canManage(info, shares, { email: me, scope: SCOPE.full }, project);
    canManageProject(project, { email: me, scope: SCOPE.full });
    canEditProject(project, me);
    roleFor(info, me, shares, project);
    expect(JSON.stringify({ info, shares, project })).toBe(before);
  });
});
