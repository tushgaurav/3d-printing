// Copies the Layer1 touch UI into public/demo so the site can embed it live, running
// against its built-in simulated printer (?demo=printing). Runs before `dev` and
// `build`, so the site always ships the UI as it is in the repo. public/demo is
// gitignored: the touch UI's own folder stays the single source.
import { cp, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../octoprint_layer1/static");
const dest = path.resolve(here, "../public/demo");

try {
  await access(path.join(src, "index.html"));
} catch {
  console.error(`copy-demo: no touch UI at ${src}. Build from the full repo, not just marketing/.`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.log("copy-demo: touch UI copied to public/demo");
