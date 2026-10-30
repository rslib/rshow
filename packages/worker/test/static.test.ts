import { describe, expect, it } from "vitest";
import appCss from "../static/app.css?raw";
import appJs from "../static/app.js?raw";
import modeJs from "../static/mode.js?raw";
import { APP_CSS, APP_JS, MODE_JS } from "../src/static.generated";
import { api } from "./helpers";

const ASSETS = [
  { path: "/static/app.css", type: "text/css; charset=utf-8", body: appCss, embedded: APP_CSS },
  { path: "/static/app.js", type: "text/javascript; charset=utf-8", body: appJs, embedded: APP_JS },
  { path: "/static/mode.js", type: "text/javascript; charset=utf-8", body: modeJs, embedded: MODE_JS }
];

describe("static assets", () => {
  for (const asset of ASSETS) {
    it(`serves ${asset.path} byte for byte from static/`, async () => {
      const res = await api("GET", asset.path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(asset.type);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(await res.text()).toBe(asset.body);
      expect(asset.embedded).toBe(asset.body);
    });
  }
});
