const path = require("node:path");
const { prepareMacMpv } = require("./lib/mac-mpv.cjs");
const { ensureMacNowPlayingForArch } = require("./lib/mac-native.cjs");
const { ensureMacSharp } = require("./lib/sharp-runtime.cjs");

const ARCH_BY_ID = {
  1: "x64",
  3: "arm64",
  4: "universal",
};

/**
 * electron-builder packs x64 and arm64 sequentially. Prepare the decoder,
 * sharp prebuild and Now Playing addon for the architecture currently being
 * packed so both DMGs contain native code for their own CPU.
 */
module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const arch = ARCH_BY_ID[context.arch] ?? String(context.arch);
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported macOS packaging architecture: ${arch}`);
  }
  const rootDir = context.packager?.projectDir ?? path.resolve(__dirname, "..");
  console.log(`Preparing macOS ${arch} native runtime...`);
  await prepareMacMpv(arch, { rootDir, allowSystemFallback: false });
  await ensureMacSharp(arch, { rootDir });
  try {
    ensureMacNowPlayingForArch(rootDir, arch);
  } catch (error) {
    if (process.env.ARIA_ALLOW_MISSING_MAC_NATIVE === "1") {
      console.warn(`aria-nowplaying unavailable, continuing without native media keys: ${error instanceof Error ? error.message : error}`);
    } else {
      throw error;
    }
  }
};
