const fs = require("node:fs");
const path = require("node:path");

// Loads the prebuilt taskbar iconic-thumbnail addon. The addon is optional:
// when the binary is missing or fails to load (for example on non-Windows),
// the app falls back to the thumbnail-clip preview. Electron may resolve the
// JS wrapper from app.asar, while native binaries live in app.asar.unpacked,
// so include both paths explicitly.
let binding = null;
const candidates = [
  path.join(__dirname, "aria_thumbnail.node"),
  process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "native", "aria-thumbnail", "aria_thumbnail.node")
    : null,
  path.join(__dirname, "build", "Release", "aria_thumbnail.node"),
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
  attach: (hwndBuffer) => binding && binding.attach(hwndBuffer),
  setBitmap: (buffer, width, height) => binding && binding.setBitmap(buffer, width, height),
  setLiveBitmap: (buffer, width, height) => binding && binding.setLiveBitmap(buffer, width, height),
  clearBitmap: () => binding && binding.clearBitmap(),
  detach: () => binding && binding.detach(),
  getStats: () => binding && binding.getStats(),
};
