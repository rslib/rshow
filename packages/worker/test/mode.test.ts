import { describe, expect, it } from "vitest";
import { api, createArtifact, INDEX_HTML, publishFiles } from "./helpers";

const MODE_SCRIPT = '<script src="/static/mode.js"></script>';

function headOf(body: string): string {
  const end = body.indexOf("</head>");
  return end === -1 ? body : body.slice(0, end);
}

function headerOf(body: string): string {
  const start = body.indexOf("<header");
  const end = body.indexOf("</header>");
  if (start === -1 || end === -1) return "";
  return body.slice(start, end);
}

describe("light and dark mode", () => {
  it("serves the mode script with a javascript content type", async () => {
    const res = await api("GET", "/static/mode.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const script = await res.text();
    expect(script).toContain("rshow-mode");
    expect(script).toContain("dataset.mode");
    expect(script).toContain("localStorage");
  });

  it("links the mode script first in the head of every ui page", async () => {
    await createArtifact("mode-doc");
    await publishFiles("mode-doc", [INDEX_HTML]);
    const pages = [
      await (await api("GET", "/")).text(),
      await (await api("GET", "/tokens")).text(),
      await (await api("GET", "/a/mode-doc")).text(),
      await (await api("GET", "/a/missing-doc")).text(),
      await (await api("GET", "/", { email: null })).text()
    ];
    for (const body of pages) {
      const head = headOf(body);
      expect(head).toContain(MODE_SCRIPT);
      expect(head.indexOf("/static/mode.js")).toBeLessThan(head.indexOf("/static/app.css"));
    }
  });

  it("renders a real mode toggle button in the header", async () => {
    for (const path of ["/", "/tokens"]) {
      const header = headerOf(await (await api("GET", path)).text());
      expect(header).toContain("<button");
      expect(header).toContain('id="mode-toggle"');
      expect(header).toContain("mode-toggle");
      expect(header).toContain("System");
      expect(header).toMatch(/aria-label="Color mode: System/);
    }
  });

  it("wires the toggle in app.js without inline handlers", async () => {
    const body = await (await api("GET", "/")).text();
    expect(body).not.toContain("onclick=");
    const script = await (await api("GET", "/static/app.js")).text();
    expect(script).toContain("rshow-mode");
    expect(script).toContain("mode-toggle");
    expect(script).toContain("dataset.mode");
    expect(script).toContain("try");
  });

  it("ships carbon g10 light and g100 dark tokens in the stylesheet", async () => {
    const css = await (await api("GET", "/static/app.css")).text();
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(':root:not([data-mode="light"])');
    expect(css).toContain(':root[data-mode="dark"]');
    for (const value of ["#161616", "#262626", "#393939", "#6f6f6f", "#f4f4f4", "#c6c6c6", "#78a9ff", "#ffffff", "#fa4d56", "#42be65"]) {
      expect(css).toContain(value);
    }
    expect(css).toContain("--tag-blue-ink:#d0e2ff");
    expect(css).toContain("--tag-teal-ink:#9ef0f0");
  });

  it("keeps the csp free of inline script allowances", async () => {
    const res = await api("GET", "/");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });
});
