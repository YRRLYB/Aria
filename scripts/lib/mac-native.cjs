const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assertMacBinary, inspectMachO } = require("./macho.cjs");

const ADDON_DIR = path.join("electron", "native", "aria-nowplaying");
const ADDON_NAME = "aria_nowplaying";
const SOURCE_FILES = ["binding.gyp", "nowplaying.mm", "index.cjs"];

function sourceMtime(rootDir) {
  return Math.max(
    ...SOURCE_FILES.map((file) => {
      try {
        return fs.statSync(path.join(rootDir, ADDON_DIR, file)).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
}

function cachedAddonPath(rootDir, arch) {
  return path.join(rootDir, ".cache", "mac-native", arch, `${ADDON_NAME}.node`);
}

function hasArch(addonPath, arch) {
  try {
    const info = inspectMachO(addonPath);
    return Boolean(info?.archs.includes(arch));
  } catch {
    return false;
  }
}

function runNodeGyp(rootDir, arch) {
  const nodeGypEntry = path.join(rootDir, "node_modules", "node-gyp", "bin", "node-gyp.js");
  const env = {
    ...process.env,
    npm_config_arch: arch,
    npm_config_target_arch: arch,
    ARCHFLAGS: `-arch ${arch}`,
  };
  console.log(`Building macOS Now Playing addon (${arch})...`);
  const result = spawnSync(
    process.execPath,
    [nodeGypEntry, "rebuild", "--directory", path.join(rootDir, ADDON_DIR), `--arch=${arch}`],
    { cwd: rootDir, stdio: "inherit", env, shell: false },
  );
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw new Error(`node-gyp failed for ${arch} (exit ${result.status})`);

  const built = path.join(rootDir, ADDON_DIR, "build", "Release", `${ADDON_NAME}.node`);
  if (!fs.existsSync(built)) throw new Error(`node-gyp did not produce ${built}`);
  const info = assertMacBinary(built, arch, `aria-nowplaying (${arch})`);
  console.log(`Built aria-nowplaying for ${info.archs.join("+")} (macOS ${info.slices[0]?.minOS ?? "unknown"})`);

  const cachePath = cachedAddonPath(rootDir, arch);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.copyFileSync(built, cachePath);
  return cachePath;
}

function buildAddon(rootDir, arch, { force = false } = {}) {
  const cached = cachedAddonPath(rootDir, arch);
  if (!force && fs.existsSync(cached) && fs.statSync(cached).mtimeMs >= sourceMtime(rootDir) && hasArch(cached, arch)) {
    return cached;
  }
  return runNodeGyp(rootDir, arch);
}

function lipoUniversal(rootDir) {
  const x64 = cachedAddonPath(rootDir, "x64");
  const arm64 = cachedAddonPath(rootDir, "arm64");
  const target = path.join(rootDir, ADDON_DIR, `${ADDON_NAME}.node`);
  const result = spawnSync("/usr/bin/lipo", ["-create", x64, arm64, "-output", target], { stdio: "inherit" });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) throw new Error(`lipo failed with exit ${result.status}`);
  assertMacBinary(target, "universal", "aria-nowplaying universal");
  fs.chmodSync(target, 0o755);
  const info = inspectMachO(target);
  console.log(`Installed universal aria-nowplaying (${info.archs.join("+")}) at ${target}`);
  return target;
}

function installSingleArch(rootDir, arch) {
  const source = cachedAddonPath(rootDir, arch);
  const target = path.join(rootDir, ADDON_DIR, `${ADDON_NAME}.node`);
  assertMacBinary(source, arch, `aria-nowplaying (${arch})`);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  console.log(`Installed ${arch} aria-nowplaying at ${target}`);
  return target;
}

/**
 * Build a universal addon when possible. If one architecture cannot be
 * cross-compiled, fall back to the host slice so development builds still
 * work; release packaging verifies the final app in afterPack and refuses to
 * ship a mismatched addon.
 */
function buildUniversalMacNowPlaying(rootDir, options = {}) {
  const errors = [];
  for (const arch of ["x64", "arm64"]) {
    try {
      buildAddon(rootDir, arch, options);
    } catch (error) {
      errors.push(`${arch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const haveBoth = fs.existsSync(cachedAddonPath(rootDir, "x64")) && fs.existsSync(cachedAddonPath(rootDir, "arm64"));
  if (haveBoth) {
    try {
      return lipoUniversal(rootDir);
    } catch (error) {
      errors.push(`lipo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const hostArch = process.arch === "arm64" ? "arm64" : "x64";
  if (fs.existsSync(cachedAddonPath(rootDir, hostArch))) {
    for (const message of errors) console.log(`aria-nowplaying: ${message}`);
    console.log(`aria-nowplaying: falling back to the host ${hostArch} slice. Release packaging will verify architecture.`);
    return installSingleArch(rootDir, hostArch);
  }
  throw new Error(`Unable to build aria-nowplaying for any macOS architecture:\n${errors.join("\n")}`);
}

function ensureMacNowPlayingForArch(rootDir, arch) {
  const target = path.join(rootDir, ADDON_DIR, `${ADDON_NAME}.node`);
  if (hasArch(target, arch)) {
    return target;
  }
  // Try a universal build first; it satisfies both DMGs in one pass.
  return buildUniversalMacNowPlaying(rootDir, { force: false });
}

module.exports = {
  ADDON_DIR,
  buildUniversalMacNowPlaying,
  ensureMacNowPlayingForArch,
  cachedAddonPath,
  hasArch,
};
