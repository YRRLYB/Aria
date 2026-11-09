const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { inspectMachO, assertMacBinary, describe } = require("./macho.cjs");

// Pinned community build used for both Intel and Apple Silicon. Unlike the
// official mpv releases (which only cover macOS 14+ on ARM and macOS 15+ on
// Intel), these binaries target macOS 11 and are published on the same day for
// both architectures. Electron 43 itself requires macOS 12+, so this gives one
// consistent decoder floor for every supported Mac.
const MAC_MPV_RELEASE = "2026-11-09";
const MAC_MPV_ASSETS = {
  x64: {
    archive: "mpv-x86_64-git-d9d402dc07.zip",
    sha256: "d17d4665d875961ff89a7552546fdcadbc01e7b3ad8f17b869bcbe31a0b691cc",
  },
  arm64: {
    archive: "mpv-arm64-git-d9d402dc07.zip",
    sha256: "bbb4c62105b7e9153e067017d41b6352e30c30f1675625765febc7c4c1fe353a",
  },
};
const MAC_MPV_BASE_URL = "https://github.com/eko5624/mpv-mac/releases/download";
const SYSTEM_MPV_CANDIDATES = [
  "/opt/homebrew/bin/mpv",
  "/usr/local/bin/mpv",
  "/opt/local/bin/mpv",
  "/Applications/mpv.app/Contents/MacOS/mpv",
];

function normalizeArch(arch) {
  if (arch === "x86_64" || arch === "amd64") return "x64";
  if (arch === "aarch64") return "arm64";
  return arch;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "Aria-mpv-bootstrap/1.0" } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadFile(new URL(response.headers.location, url).href, destination, redirects + 1).then(resolve, reject);
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
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
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

function installMacMpv({ sourceBinary, sourceLibDir, vendorDir, arch, release, source }) {
  const binary = fs.realpathSync(sourceBinary);
  assertMacBinary(binary, arch, `macOS mpv (${arch})`);
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  const targetBinary = path.join(vendorDir, "mpv");
  fs.copyFileSync(binary, targetBinary);
  fs.chmodSync(targetBinary, 0o755);

  if (sourceLibDir && fs.existsSync(sourceLibDir)) {
    const targetLib = path.join(vendorDir, "lib");
    fs.cpSync(fs.realpathSync(sourceLibDir), targetLib, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    // Remove repository placeholders that add no value to the app bundle.
    fs.rmSync(path.join(targetLib, ".gitkeep"), { force: true });
    for (const library of fs.readdirSync(targetLib)) {
      const libraryPath = path.join(targetLib, library);
      if (library.endsWith(".dylib")) assertMacBinary(libraryPath, arch, `macOS mpv library ${library}`);
    }
  }

  // Downloaded archives keep com.apple.quarantine; a child process inherits it
  // and Gatekeeper aborts the decoder on first launch.
  for (const target of [targetBinary, path.join(vendorDir, "lib")]) {
    try {
      execFileSync("/usr/bin/xattr", ["-cr", target], { stdio: "ignore" });
    } catch {
      // xattr is optional.
    }
  }

  fs.writeFileSync(
    path.join(vendorDir, ".aria-mpv.json"),
    `${JSON.stringify({ arch, release, source, installedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  console.log(`installed macOS mpv ${release} (${arch}) at ${targetBinary}`);
  return targetBinary;
}

function readMarker(vendorDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vendorDir, ".aria-mpv.json"), "utf8"));
  } catch {
    return null;
  }
}

function cachedMpvIsUsable(vendorDir, arch) {
  const marker = readMarker(vendorDir);
  const binary = path.join(vendorDir, "mpv");
  if (!marker || marker.arch !== arch || marker.release !== MAC_MPV_RELEASE) return false;
  if (!fs.existsSync(binary)) return false;
  try {
    assertMacBinary(binary, arch, "cached macOS mpv");
    return true;
  } catch {
    return false;
  }
}

async function downloadMacMpv({ arch, rootDir }) {
  const asset = MAC_MPV_ASSETS[arch];
  if (!asset) throw new Error(`Unsupported macOS mpv architecture: ${arch}`);
  const cacheDir = path.join(rootDir, ".cache", "mpv-macos", MAC_MPV_RELEASE, arch);
  fs.mkdirSync(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, asset.archive);
  const url = `${MAC_MPV_BASE_URL}/${MAC_MPV_RELEASE}/${asset.archive}`;

  let needsDownload = !fs.existsSync(archivePath);
  if (!needsDownload) {
    const digest = sha256File(archivePath);
    if (digest !== asset.sha256) {
      console.log(`cached macOS mpv archive hash mismatch, re-downloading (${digest})`);
      needsDownload = true;
    }
  }
  if (needsDownload) {
    console.log(`Downloading macOS mpv ${MAC_MPV_RELEASE} (${arch})`);
    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        fs.rmSync(archivePath, { force: true });
        await downloadFile(url, archivePath);
        const digest = sha256File(archivePath);
        if (digest !== asset.sha256) throw new Error(`SHA256 mismatch: expected ${asset.sha256}, got ${digest}`);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 4) console.log(`macOS mpv download retry ${attempt}/4 failed, retrying...`);
      }
    }
    if (lastError) throw lastError;
  }

  const unpackPath = path.join(cacheDir, "unpacked");
  fs.rmSync(unpackPath, { recursive: true, force: true });
  fs.mkdirSync(unpackPath, { recursive: true });
  execFileSync("/usr/bin/unzip", ["-q", "-o", archivePath, "-d", unpackPath], { stdio: "inherit" });
  const appDir = findEntry(unpackPath, "mpv.app", "dir");
  const binary = appDir
    ? path.join(appDir, "Contents", "MacOS", "mpv")
    : findEntry(unpackPath, "mpv", "file");
  const libDir = appDir
    ? path.join(appDir, "Contents", "MacOS", "lib")
    : binary
      ? path.join(path.dirname(binary), "lib")
      : null;
  if (!binary || !fs.existsSync(binary)) {
    throw new Error(`Downloaded mpv archive ${asset.archive} did not contain a usable mpv binary.`);
  }
  return { binary, libDir, archivePath };
}

function findSystemMpv(arch) {
  const candidates = [...SYSTEM_MPV_CANDIDATES];
  try {
    const onPath = execFileSync("/usr/bin/which", ["mpv"], { encoding: "utf8" }).trim();
    if (onPath && !candidates.includes(onPath)) candidates.unshift(onPath);
  } catch {
    // No mpv on PATH.
  }
  for (const candidate of candidates) {
    try {
      assertMacBinary(candidate, arch, `system mpv ${candidate}`);
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Wrong architecture or not runnable.
    }
  }
  return null;
}

async function prepareMacMpv(targetArch, options = {}) {
  const arch = normalizeArch(targetArch);
  if (!MAC_MPV_ASSETS[arch]) throw new Error(`Unsupported macOS mpv architecture: ${targetArch}`);
  const rootDir = options.rootDir ?? path.resolve(__dirname, "..", "..");
  const vendorDir = path.join(rootDir, "vendor", "mpv");
  if (!options.force && cachedMpvIsUsable(vendorDir, arch)) {
    console.log(`native mpv already available at ${path.join(vendorDir, "mpv")} (${arch})`);
    return path.join(vendorDir, "mpv");
  }

  try {
    const { binary, libDir } = await downloadMacMpv({ arch, rootDir });
    return installMacMpv({ sourceBinary: binary, sourceLibDir: libDir, vendorDir, arch, release: MAC_MPV_RELEASE, source: "eko5624/mpv-mac" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`macOS mpv download failed: ${message}`);
    if (options.allowSystemFallback === false) throw error;
    const systemMpv = findSystemMpv(arch);
    if (!systemMpv) throw new Error(`No usable ${arch} mpv for macOS found. Install mpv (brew install mpv) or retry with network access.`);
    return installMacMpv({
      sourceBinary: systemMpv,
      sourceLibDir: path.join(path.dirname(systemMpv), "lib"),
      vendorDir,
      arch,
      release: "system",
      source: systemMpv,
    });
  }
}

module.exports = {
  MAC_MPV_RELEASE,
  MAC_MPV_ASSETS,
  normalizeArch,
  prepareMacMpv,
  cachedMpvIsUsable,
  describe,
  inspectMachO,
};
