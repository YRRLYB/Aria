// Bundle electron-updater into the Electron main process so the packaged app
// does not need the whole production node_modules tree. electron/updater.cjs
// remains the readable source used in development.
const esbuild = require("esbuild");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
esbuild.buildSync({
  entryPoints: [path.join(root, "electron", "updater.cjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  outfile: path.join(root, "electron", "updater.bundle.cjs"),
  logLevel: "info",
});
console.log("bundled electron/updater.bundle.cjs");
