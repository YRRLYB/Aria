const fs = require("node:fs");
const path = require("node:path");
const { assertMacBinary } = require("./lib/macho.cjs");

const ARCH_BY_ID = {
  1: "x64",
  3: "arm64",
  4: "universal",
};

function appBundle(appOutDir) {
  if (!fs.existsSync(appOutDir)) throw new Error(`Packaged output is missing: ${appOutDir}`);
  const bundle = fs.readdirSync(appOutDir).find((entry) => entry.endsWith(".app"));
  if (!bundle) throw new Error(`No .app bundle found in ${appOutDir}`);
  return path.join(appOutDir, bundle);
}

/**
 * Last line of defence: never publish a DMG whose native pieces belong to the
 * other architecture. This catches a stale vendor/mpv, a host-only addon or an
 * electronDist mix-up before the artifact is uploaded.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const arch = ARCH_BY_ID[context.arch] ?? String(context.arch);
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported macOS packaging architecture: ${arch}`);
  }
  const appDir = appBundle(context.appOutDir);
  const resources = path.join(appDir, "Contents", "Resources");
  const unpacked = path.join(resources, "app.asar.unpacked");

  const checks = [
    {
      label: `Electron ${arch}`,
      file: path.join(appDir, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Electron Framework"),
    },
    {
      label: `mpv ${arch}`,
      file: path.join(unpacked, "vendor", "mpv", "mpv"),
    },
    {
      label: `mpv libluajit ${arch}`,
      file: path.join(unpacked, "vendor", "mpv", "lib", "libluajit-5.1.2.dylib"),
    },
    {
      label: `Now Playing addon ${arch}`,
      file: path.join(unpacked, "electron", "native", "aria-nowplaying", "aria_nowplaying.node"),
    },
    {
      label: `sharp ${arch}`,
      file: path.join(unpacked, "dist-server", "node_modules", "@img", `sharp-darwin-${arch}`, "lib", `sharp-darwin-${arch}.node`),
    },
  ];
  for (const check of checks) {
    if (process.env.ARIA_ALLOW_MISSING_MAC_NATIVE === "1" && check.label.startsWith("Now Playing") && !fs.existsSync(check.file)) {
      console.warn(`${check.label} is missing; native media keys will fall back to Chromium media session.`);
      continue;
    }
    if (!fs.existsSync(check.file)) throw new Error(`${check.label} is missing: ${check.file}`);
    const info = assertMacBinary(check.file, arch, check.label);
    console.log(`verified ${check.label}: ${info.slices.map((slice) => `${slice.arch}${slice.minOS ? ` (macOS ${slice.minOS})` : ""}`).join(", ")}`);
  }
};
