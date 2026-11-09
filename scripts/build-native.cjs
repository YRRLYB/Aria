const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { buildUniversalMacNowPlaying } = require("./lib/mac-native.cjs");

const rootDir = process.cwd();
const nodeGypEntry = path.join(rootDir, "node_modules", "node-gyp", "bin", "node-gyp.js");

function buildModule(directory, moduleName) {
  const result = spawnSync(process.execPath, [nodeGypEntry, "rebuild", "--directory", directory], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
  const source = path.join(rootDir, directory, "build", "Release", `${moduleName}.node`);
  const target = path.join(rootDir, directory, `${moduleName}.node`);
  fs.copyFileSync(source, target);
  console.log(`Copied native module to ${target}`);
}

if (process.platform === "win32") {
  buildModule("electron/native/aria-thumbnail", "aria_thumbnail");
} else if (process.platform === "darwin") {
  // The macOS Now Playing addon is built for both Intel and Apple Silicon and
  // merged with lipo. A missing toolchain must not block the web/backend build;
  // electron-builder's beforePack/afterPack hooks then enforce the target arch.
  try {
    buildUniversalMacNowPlaying(rootDir);
  } catch (error) {
    console.error(`aria-nowplaying build failed, continuing without it: ${error?.message || error}`);
  }
} else {
  console.log("Skipping native modules on this platform.");
}
