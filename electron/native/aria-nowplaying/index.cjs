const fs = require("node:fs");
const path = require("node:path");

// Loads the macOS Now Playing addon (MPNowPlayingInfoCenter +
// MPRemoteCommandCenter). The addon is optional: when the binary is missing
// or fails to load (non-macOS hosts, unsigned toolchains), the desktop shell
// falls back to Chromium's MediaSessionService. Electron may resolve this JS
// wrapper from app.asar while native binaries live in app.asar.unpacked, so
// both locations are probed.
let binding = null;
const candidates = [
  path.join(__dirname, "aria_nowplaying.node"),
  process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "native", "aria-nowplaying", "aria_nowplaying.node")
    : null,
  path.join(__dirname, "build", "Release", "aria_nowplaying.node"),
].filter(Boolean);
for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) continue;
  try {
    binding = require(candidate);
    break;
  } catch {
    // Try the next location; the addon remains optional.
  }
}

module.exports = {
  available: Boolean(binding),
  attach: (callback) => binding?.attach?.(callback),
  updateMediaSession: (state, artwork) => binding?.updateMediaSession?.(state, artwork),
  detach: () => binding?.detach?.(),
};
