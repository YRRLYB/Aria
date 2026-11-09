const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { assertMacBinary } = require("./macho.cjs");

const REGISTRY = "https://registry.npmjs.org";

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "Aria-sharp-bootstrap/1.0" } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          download(new URL(response.headers.location, url).href, destination, redirects + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with status ${response.statusCode}: ${url}`));
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

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Aria-sharp-bootstrap/1.0" } });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}): ${url}`);
  return response.json();
}

function verifyIntegrity(filePath, integrity) {
  if (!integrity) return;
  const [algorithm, expected] = String(integrity).split("-", 2);
  if (!algorithm || !expected || algorithm !== "sha512") return;
  const actual = crypto.createHash("sha512").update(fs.readFileSync(filePath)).digest("base64");
  if (actual !== expected) {
    throw new Error(`npm tarball integrity mismatch for ${filePath}`);
  }
}

async function ensurePackage({ rootDir, name, version, cacheRoot, targetDir }) {
  const safeName = name.replace("@", "").replace("/", "-");
  const archivePath = path.join(cacheRoot, `${safeName}-${version}.tgz`);
  const unpackDir = path.join(cacheRoot, `${safeName}-${version}`);
  const metadata = await fetchJson(`${REGISTRY}/${encodeURIComponent(name).replace("%40", "@")}/${version}`);
  const tarball = metadata?.dist?.tarball;
  if (!tarball) throw new Error(`No tarball metadata for ${name}@${version}`);

  if (!fs.existsSync(archivePath)) {
    console.log(`Downloading ${name}@${version} for macOS packaging`);
    await download(tarball, archivePath);
  }
  verifyIntegrity(archivePath, metadata?.dist?.integrity);

  if (!fs.existsSync(path.join(unpackDir, "package", "package.json"))) {
    fs.rmSync(unpackDir, { recursive: true, force: true });
    fs.mkdirSync(unpackDir, { recursive: true });
    execFileSync("/usr/bin/tar", ["-xzf", archivePath, "-C", unpackDir], { stdio: "inherit" });
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(path.join(unpackDir, "package"), targetDir, { recursive: true, force: true });
  return targetDir;
}

function pruneOtherArchitectures(imgDir, arch) {
  if (!fs.existsSync(imgDir)) return;
  const keep = new Set([`sharp-darwin-${arch}`, `sharp-libvips-darwin-${arch}`]);
  for (const entry of fs.readdirSync(imgDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^(sharp|sharp-libvips)-/.test(entry.name)) continue;
    if (!keep.has(entry.name)) fs.rmSync(path.join(imgDir, entry.name), { recursive: true, force: true });
  }
}

/**
 * electron-builder rebuilds native Node modules for the host architecture, but
 * sharp ships prebuilt platform packages as optional npm dependencies. A
 * universal DMG build therefore needs the target architecture's sharp/libvips
 * packages staged explicitly. The server loads sharp from
 * dist-server/node_modules, so that is the copy that matters at runtime.
 */
async function ensureMacSharp(targetArch, { rootDir = path.resolve(__dirname, "..", "..") } = {}) {
  const arch = targetArch === "x86_64" ? "x64" : targetArch === "aarch64" ? "arm64" : targetArch;
  if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported sharp architecture: ${targetArch}`);
  const serverModules = path.join(rootDir, "dist-server", "node_modules");
  const sharpDir = path.join(serverModules, "sharp");
  if (!fs.existsSync(path.join(sharpDir, "package.json"))) {
    throw new Error("dist-server/node_modules/sharp is missing; run npm run build:server first");
  }
  const sharpManifest = JSON.parse(fs.readFileSync(path.join(sharpDir, "package.json"), "utf8"));
  const optional = sharpManifest.optionalDependencies ?? {};
  const sharpPackage = `@img/sharp-darwin-${arch}`;
  const libvipsPackage = `@img/sharp-libvips-darwin-${arch}`;
  const sharpVersion = optional[sharpPackage];
  const libvipsVersion = optional[libvipsPackage];
  if (!sharpVersion || !libvipsVersion) {
    throw new Error(`sharp ${sharpManifest.version} does not publish darwin-${arch} prebuilds`);
  }

  const imgDir = path.join(serverModules, "@img");
  const cacheRoot = path.join(rootDir, ".cache", "sharp-darwin", arch);
  fs.mkdirSync(cacheRoot, { recursive: true });
  await ensurePackage({
    rootDir,
    name: sharpPackage,
    version: sharpVersion,
    cacheRoot,
    targetDir: path.join(imgDir, `sharp-darwin-${arch}`),
  });
  await ensurePackage({
    rootDir,
    name: libvipsPackage,
    version: libvipsVersion,
    cacheRoot,
    targetDir: path.join(imgDir, `sharp-libvips-darwin-${arch}`),
  });
  pruneOtherArchitectures(imgDir, arch);

  const sharpBinary = path.join(imgDir, `sharp-darwin-${arch}`, "lib", `sharp-darwin-${arch}.node`);
  assertMacBinary(sharpBinary, arch, `sharp ${arch}`);
  const libDir = path.join(imgDir, `sharp-libvips-darwin-${arch}`, "lib");
  for (const entry of fs.readdirSync(libDir)) {
    if (entry.endsWith(".dylib")) assertMacBinary(path.join(libDir, entry), arch, `sharp libvips ${entry}`);
  }
  console.log(`staged sharp ${sharpVersion} + libvips ${libvipsVersion} (darwin-${arch})`);
  return { sharpPackage, sharpVersion, libvipsPackage, libvipsVersion };
}

module.exports = { ensureMacSharp };
