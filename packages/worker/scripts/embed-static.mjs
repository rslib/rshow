// Regenerates src/static.generated.ts from the asset files in static/.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ASSETS = [
  { file: "app.css", name: "APP_CSS" },
  { file: "app.js", name: "APP_JS" },
  { file: "mode.js", name: "MODE_JS" }
];

const lines = [];
for (const asset of ASSETS) {
  const body = await readFile(join(root, "static", asset.file), "utf8");
  lines.push(`export const ${asset.name} = ${JSON.stringify(body)};`);
}

await writeFile(join(root, "src", "static.generated.ts"), `${lines.join("\n")}\n`);
