import type { Child } from "hono/jsx";
import type { Mode } from "../constants";
import type { Env } from "../types";
import type { NavProject } from "./types";

export const ISLAND = {
  share: "share",
  versions: "versions",
  project: "project",
  copy: "copy",
  tokens: "tokens",
  delete: "delete"
} as const;

export const MODE_LABEL: Record<string, string> = {
  private: "Private",
  people: "People",
  public: "Public"
};

export const MODE_ORDER: readonly Mode[] = ["private", "people", "public"];

export function islandProps(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export function renderPage(node: unknown): string {
  return `<!doctype html>${String(node)}`;
}

export function titleCase(value: string): string {
  return value === "" ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

export function shortDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function navHref(key: "artifacts" | "shared" | "tokens" | "new", project?: string | null): string {
  if (key === "shared") return "/?share=shared";
  if (key === "tokens") return "/tokens";
  if (key === "new") return "/projects/new";
  if (project) return `/?project=${encodeURIComponent(project)}`;
  return "/";
}

function Chrome(props: {
  env: Env;
  email: string;
  title: string;
  search: string;
  children?: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} - rshow`}</title>
        <script src="/static/mode.js"></script>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@300;400;600&display=swap"
        />
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>
        <div class="app">
          <header class="topbar">
            <a class="brand" href="/">
              rshow<span class="brand-sub">admin</span>
            </a>
            <form class="search" method="get" action="/" role="search">
              <span class="search-icon" aria-hidden="true">
                &#9906;
              </span>
              <label class="sr-only" for="top-search">
                Search artifacts and projects
              </label>
              <input
                id="top-search"
                name="q"
                type="search"
                value={props.search}
                placeholder="Search artifacts and projects"
                autocomplete="off"
              />
            </form>
            <span class="top-spacer"></span>
            <button
              type="button"
              class="mode-toggle"
              id="mode-toggle"
              aria-label="Color mode: System. Activate to cycle System, Light, Dark."
            >
              <span aria-hidden="true">&#9681;</span>
              <span>System</span>
            </button>
            <span class="topbar-user" title={props.email}>
              [{props.email}]
            </span>
          </header>
          {props.children}
        </div>
        <script src="/static/app.js"></script>
      </body>
    </html>
  );
}

export function NavLayout(props: {
  env: Env;
  email: string;
  title: string;
  search: string;
  projects: NavProject[];
  active: "artifacts" | "shared" | "tokens" | "new";
  activeProject?: string | null;
  children?: Child;
}) {
  const itemClass = (on: boolean) => (on ? "nav-item is-active" : "nav-item");
  return (
    <Chrome env={props.env} email={props.email} title={props.title} search={props.search}>
      <div class="shell">
        <nav class="sidenav" aria-label="Main">
          <a href="/" class={itemClass(props.active === "artifacts" && !props.activeProject)}>
            All artifacts
          </a>
          <a href={navHref("shared")} class={itemClass(props.active === "shared")}>
            Shared with me
          </a>
          <p class="nav-heading">Projects</p>
          {props.projects.map((project) => (
            <a href={navHref("artifacts", project.slug)} class={itemClass(props.activeProject === project.slug)}>
              <span class="nav-label">{project.title}</span>
              <span class="nav-count">{project.count}</span>
            </a>
          ))}
          <a href={navHref("new")} class={itemClass(props.active === "new")}>
            New project
          </a>
          <p class="nav-heading">Settings</p>
          <a href={navHref("tokens")} class={itemClass(props.active === "tokens")}>
            Tokens
          </a>
        </nav>
        <main class="main">{props.children}</main>
      </div>
    </Chrome>
  );
}

export function DetailLayout(props: { env: Env; email: string; title: string; children?: Child }) {
  return (
    <Chrome env={props.env} email={props.email} title={props.title} search="">
      <main class="page">{props.children}</main>
    </Chrome>
  );
}

export function Breadcrumbs(props: { project?: { slug: string; title: string } | null; title: string }) {
  return (
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="/">All artifacts</a>
      {props.project ? (
        <span>
          <span class="crumb-sep">/</span>
          <a href={`/p/${props.project.slug}`}>{props.project.title}</a>
        </span>
      ) : (
        <span>
          <span class="crumb-sep">/</span>
          Projects
        </span>
      )}
      <span class="crumb-sep">/</span>
      <span aria-current="page">{props.title}</span>
    </nav>
  );
}

export function Pill(props: { mode: string }) {
  return <span class={`pill pill-${props.mode}`}>{MODE_LABEL[props.mode] ?? titleCase(props.mode)}</span>;
}

export function RemoveButton(props: { action: string; email: string; label: string }) {
  return (
    <button
      type="button"
      class="icon-btn"
      data-action={props.action}
      data-email={props.email}
      aria-label={props.label}
      title={props.label}
    >
      <span aria-hidden="true">&#215;</span>
    </button>
  );
}
