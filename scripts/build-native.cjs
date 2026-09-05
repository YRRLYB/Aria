const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32") {
  console.log("Skipping Windows taskbar native module on non-Windows.");
  process.exit(0);
}

const nodeGypEntry = path.join(process.cwd(), "node_modules", "node-gyp", "bin", "node-gyp.js");
const result = spawnSync(process.execPath, [nodeGypEntry, "rebuild", "--directory", "electron/native/aria-thumbnail"], {
  stdio: "inherit",
  shell: false,
});

if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const source = path.join(process.cwd(), "electron", "native", "aria-thumbnail", "build", "Release", "aria_thumbnail.node");
const target = path.join(process.cwd(), "electron", "native", "aria-thumbnail", "aria_thumbnail.node");
fs.copyFileSync(source, target);
console.log(`Copied native taskbar module to ${target}`);
