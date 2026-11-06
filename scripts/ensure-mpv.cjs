const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MPV_VERSION = "v0.41.0";
const MPV_ASSET = "mpv-v0.41.0-x86_64-pc-windows-msvc.zip";
const MPV_URL = `https://github.com/mpv-player/mpv/releases/download/${MPV_VERSION}/${MPV_ASSET}`;

const rootDir = path.resolve(__dirname, "..");
const vendorDir = path.join(rootDir, "vendor", "mpv");
const mpvExePath = path.join(vendorDir, "mpv.exe");
// OOPZ's application loopback capture selects an executable by basename. Use
// the product name for the native child process so its WASAPI stream belongs
// to the Aria app selected for sharing.
const brandedMpvExePath = path.join(vendorDir, "Aria.exe");
const cacheDir = path.join(rootDir, ".cache");
const zipPath = path.join(cacheDir, MPV_ASSET);
const unpackDir = path.join(cacheDir, "mpv-unpacked");
const tempFallbackDir = path.join(rootDir, ".tmp-mpv", "unpacked");

function downloadFile(url, destination, redirects = 0, headers = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }

    https
      .get(url, { headers: { "User-Agent": "Aria-mpv-bootstrap/1.0", ...headers } }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          const nextUrl = new URL(response.headers.location, url).href;
          downloadFile(nextUrl, destination, redirects + 1, headers).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

const macMpvPath = path.join(vendorDir, "mpv");
const macMpvLibDir = path.join(vendorDir, "lib");
const macMpvCacheDir = path.join(cacheDir, "mpv-macos");

function macosMajorVersion() {
  try {
    const version = execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
    return Number(version.split(".")[0]) || 0;
  } catch {
    return 0;
  }
}

/**
 * The official releases only ship macOS 14 arm64, macOS 15 intel/arm64 and
 * newer. Intel Sonoma (14) therefore uses the community All-in-One build,
 * which is built against macOS 11+ and runs on 14.
 */
function macMpvDownloadPlan() {
  const version = macosMajorVersion();
  if (process.arch === "x64") {
    if (version >= 15) {
      return {
        url: "https://github.com/mpv-player/mpv/releases/download/v0.42.0/mpv-v0.42.0-macos-15-intel.zip",
        archive: "mpv-v0.42.0-macos-15-intel.zip",
        headers: {},
      };
    }
    return {
      url: "https://api.github.com/repos/eko5624/mpv-macos-intel/releases/assets/176878737",
      archive: "mpv-eko-2024-07-01.zip",
      headers: { Accept: "application/octet-stream" },
    };
  }
  if (process.arch === "arm64") {
    if (version >= 26) {
      return {
        url: "https://github.com/mpv-player/mpv/releases/download/v0.42.0/mpv-v0.42.0-macos-26-arm.zip",
        archive: "mpv-v0.42.0-macos-26-arm.zip",
        headers: {},
      };
    }
    if (version >= 15) {
      return {
        url: "https://github.com/mpv-player/mpv/releases/download/v0.42.0/mpv-v0.42.0-macos-15-arm.zip",
        archive: "mpv-v0.42.0-macos-15-arm.zip",
        headers: {},
      };
    }
    if (version >= 14) {
      return {
        url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-14-arm.zip",
        archive: "mpv-v0.41.0-macos-14-arm.zip",
        headers: {},
      };
    }
  }
  return null;
}

function findEntry(root, name, kind, depth = 0) {
  if (depth > 6 || !fs.existsSync(root)) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.name === name && (kind === "dir" ? entry.isDirectory() : entry.isFile())) {
      return path.join(root, entry.name);
    }
    if (entry.isDirectory()) {
      const nested = findEntry(path.join(root, entry.name), name, kind, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function installMacMpv(sourceBinary, sourceLibDir) {
  const binary = fs.realpathSync(sourceBinary);
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.rmSync(macMpvPath, { force: true });
  fs.copyFileSync(binary, macMpvPath);
  fs.chmodSync(macMpvPath, 0o755);

  if (sourceLibDir && fs.existsSync(sourceLibDir)) {
    fs.rmSync(macMpvLibDir, { recursive: true, force: true });
    fs.cpSync(fs.realpathSync(sourceLibDir), macMpvLibDir, { recursive: true, force: true, verbatimSymlinks: true });
  }

  // Downloads carry com.apple.quarantine; a direct child process inherits it
  // and Gatekeeper would abort the decoder on first launch.
  for (const target of [macMpvPath, macMpvLibDir]) {
    try {
      execFileSync("/usr/bin/xattr", ["-cr", target], { stdio: "ignore" });
    } catch {
      // xattr is optional; the copy still works when it is unavailable.
    }
  }
  console.log(`installed macOS mpv at ${macMpvPath}${sourceLibDir ? " (with bundled libraries)" : ""}`);
}

async function downloadMacMpv(plan) {
  fs.mkdirSync(macMpvCacheDir, { recursive: true });
  const archivePath = path.join(macMpvCacheDir, plan.archive);
  if (!fs.existsSync(archivePath)) {
    console.log(`Downloading macOS mpv build (${plan.archive})`);
    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        fs.rmSync(archivePath, { force: true });
        await downloadFile(plan.url, archivePath, 0, plan.headers);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 4) console.log(`macOS mpv download retry ${attempt}/4 failed, retrying...`);
      }
    }
    if (lastError) throw lastError;
  }

  const unpackPath = path.join(macMpvCacheDir, "unpacked");
  fs.rmSync(unpackPath, { recursive: true, force: true });
  fs.mkdirSync(unpackPath, { recursive: true });
  execFileSync("/usr/bin/unzip", ["-q", "-o", archivePath, "-d", unpackPath], { stdio: "inherit" });

  let root = unpackPath;
  const nestedTar = findEntry(root, "mpv.tar.gz", "file");
  if (nestedTar) {
    const tarDir = path.join(macMpvCacheDir, "tar");
    fs.rmSync(tarDir, { recursive: true, force: true });
    fs.mkdirSync(tarDir, { recursive: true });
    execFileSync("/usr/bin/tar", ["xzf", nestedTar, "-C", tarDir], { stdio: "inherit" });
    root = tarDir;
  }

  const appDir = findEntry(root, "mpv.app", "dir");
  let binary = null;
  let libDir = null;
  if (appDir) {
    binary = path.join(appDir, "Contents", "MacOS", "mpv");
    libDir = path.join(appDir, "Contents", "MacOS", "lib");
  } else {
    binary = findEntry(root, "mpv", "file");
    libDir = binary ? path.join(path.dirname(binary), "lib") : null;
  }
  if (!binary || !fs.existsSync(binary)) {
    throw new Error(`Downloaded mpv archive ${plan.archive} did not contain a usable mpv binary.`);
  }
  installMacMpv(binary, libDir);
}

async function prepareMacMpv() {
  if (fs.existsSync(macMpvPath)) {
    console.log(`native mpv already available at ${macMpvPath}`);
    return;
  }

  const plan = macMpvDownloadPlan();
  if (plan) {
    try {
      await downloadMacMpv(plan);
      return;
    } catch (error) {
      console.log(`macOS mpv download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log(`No prebuilt mpv for macOS ${macosMajorVersion()} ${process.arch}; checking system installs.`);
  }

  // Fall back to a local mpv (Homebrew/MacPorts/mpv.app). This keeps dev builds
  // working offline, although a packaged app should prefer the vendored copy.
  const candidates = [
    "/opt/homebrew/bin/mpv",
    "/usr/local/bin/mpv",
    "/opt/local/bin/mpv",
    "/Applications/mpv.app/Contents/MacOS/mpv",
  ];
  try {
    const onPath = execFileSync("/usr/bin/which", ["mpv"], { encoding: "utf8" }).trim();
    if (onPath && !candidates.includes(onPath)) candidates.unshift(onPath);
  } catch {
    // No mpv on PATH.
  }
  const found = candidates.find((candidate) => {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (found) {
    installMacMpv(found, path.join(path.dirname(found), "lib"));
    return;
  }

  console.log("No usable mpv for macOS found; the desktop shell will use Web Audio. Install mpv (brew install mpv) or rerun with network access.");
}

async function main() {
  if (process.platform === "darwin") {
    await prepareMacMpv();
    return;
  }

  if (process.platform !== "win32") {
    console.log("Skipping mpv download outside Windows.");
    return;
  }

  if (fs.existsSync(brandedMpvExePath)) {
    console.log(`native mpv already available at ${brandedMpvExePath}`);
    return;
  }

  if (fs.existsSync(mpvExePath)) {
    brandMpvExecutable();
    console.log(`native mpv already available at ${brandedMpvExePath}`);
    return;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(path.dirname(vendorDir), { recursive: true });

  if (!fs.existsSync(zipPath) && fs.existsSync(path.join(rootDir, ".tmp-mpv", "mpv.zip"))) {
    fs.copyFileSync(path.join(rootDir, ".tmp-mpv", "mpv.zip"), zipPath);
  }

  if (!fs.existsSync(zipPath)) {
    console.log(`Downloading mpv ${MPV_VERSION} from ${MPV_URL}`);
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await downloadFile(MPV_URL, zipPath);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          console.log(`mpv download retry ${attempt}/3 failed, retrying...`);
        }
      }
    }
    if (lastError) {
      if (fs.existsSync(path.join(tempFallbackDir, "mpv.exe"))) {
        fs.rmSync(vendorDir, { recursive: true, force: true });
        fs.mkdirSync(vendorDir, { recursive: true });
        fs.cpSync(tempFallbackDir, vendorDir, { recursive: true, force: true });
        brandMpvExecutable();
        console.log(`mpv restored from ${tempFallbackDir}`);
        return;
      }
      throw lastError;
    }
  }

  fs.rmSync(unpackDir, { recursive: true, force: true });
  fs.mkdirSync(unpackDir, { recursive: true });
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${unpackDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );

  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.cpSync(unpackDir, vendorDir, { recursive: true, force: true });
  for (const removable of ["mpv-register.bat", "mpv-unregister.bat", "mpv.pdb"]) {
    fs.rmSync(path.join(vendorDir, removable), { force: true });
  }

  if (!fs.existsSync(mpvExePath)) {
    throw new Error("mpv.exe was not found after extraction.");
  }

  brandMpvExecutable();
  console.log(`mpv prepared at ${brandedMpvExePath}`);
}

function brandMpvExecutable() {
  if (fs.existsSync(brandedMpvExePath)) return;
  if (!fs.existsSync(mpvExePath)) {
    throw new Error("mpv.exe was not found while preparing the native executable.");
  }

  try {
    // Renaming avoids shipping a second 50+ MB copy of the decoder.
    fs.renameSync(mpvExePath, brandedMpvExePath);
  } catch (error) {
    throw new Error(`Unable to brand mpv as Aria.exe: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
