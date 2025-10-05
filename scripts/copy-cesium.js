// scripts/copy-cesium.js
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const src = path.join(projectRoot, "node_modules", "cesium", "Build", "Cesium");
const dest = path.join(projectRoot, "public", "cesium");

async function run() {
  await mkdir(dest, { recursive: true });
  try {
    await cp(src, dest, { recursive: true, force: true });
    console.log(`[copy-cesium] Copied assets from: ${src}`);
  } catch (e) {
    console.warn(
      "[copy-cesium] WARNING: Could not find Cesium build to copy.",
      e?.message || e
    );
  }
}
run();
