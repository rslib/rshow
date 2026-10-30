export interface UiArtifact {
  slug: string;
  title: string;
  owner: string;
  mode: string;
  pinned: number | null;
  latest: number | null;
  served: number | null;
  updated_at: string;
  role: string;
  project: string | null;
  tags: string[];
}

export interface NavProject {
  slug: string;
  title: string;
  count: number;
}

export interface UiProjectMember {
  email: string;
  role: string;
}

export interface UiProject {
  slug: string;
  title: string;
  description: string;
  owner: string;
  role: string;
  updated_at: string;
}

export interface UiProjectAccess {
  slug: string;
  title: string;
  owner: string;
  members: UiProjectMember[];
}

export interface GalleryFilters {
  project: string | null;
  tag: string | null;
  mode: string | null;
  q: string;
  share: boolean;
}

export interface GalleryTag {
  tag: string;
  count: number;
}

export interface UiToken {
  id: string;
  name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
}
