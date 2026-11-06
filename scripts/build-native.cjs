const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const nodeGypEntry = path.join(process.cwd(), "node_modules", "node-gyp", "bin", "node-gyp.js");

function buildModule(directory, moduleName) {
  const result = spawnSync(process.execPath, [nodeGypEntry, "rebuild", "--directory", directory], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
  const source = path.join(process.cwd(), directory, "build", "Release", `${moduleName}.node`);
  const target = path.join(process.cwd(), directory, `${moduleName}.node`);
  fs.copyFileSync(source, target);
  console.log(`Copied native module to ${target}`);
}

if (process.platform === "win32") {
  buildModule("electron/native/aria-thumbnail", "aria_thumbnail");
} else if (process.platform === "darwin") {
  // The macOS Now Playing addon builds with the command-line tools; a missing
  // toolchain must not block the desktop build (the shell falls back to the
  // Chromium media session).
  try {
    buildModule("electron/native/aria-nowplaying", "aria_nowplaying");
  } catch (error) {
    console.error(`aria-nowplaying build failed, continuing without it: ${error?.message || error}`);
  }
} else {
  console.log("Skipping native modules on this platform.");
}
