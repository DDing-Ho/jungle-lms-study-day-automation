import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR } from "./config.js";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function saveFailureArtifacts(page, label, error) {
  const dir = path.join(ARTIFACTS_DIR, `${timestamp()}-${label}`);
  await fs.mkdir(dir, { recursive: true });

  const payload = {
    label,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
    url: page.url(),
    capturedAt: new Date().toISOString(),
  };

  await Promise.allSettled([
    page.screenshot({ path: path.join(dir, "page.png"), fullPage: true }),
    page.content().then((html) => fs.writeFile(path.join(dir, "page.html"), html, "utf8")),
    fs.writeFile(path.join(dir, "error.json"), JSON.stringify(payload, null, 2), "utf8"),
  ]);

  return dir;
}
