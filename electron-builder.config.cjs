const path = require("node:path");

const config = {
  appId: "com.yrrlyb.aria",
  productName: "Aria",
  directories: {
    output: "release",
  },
  // The desktop shell and bundled backend do not load packages from the root
  // node_modules. Excluding it keeps packaging fast and prevents host-only
  // native modules (sharp/libvips) from leaking into a cross-arch macOS DMG.
  npmRebuild: false,
  concurrency: {
    jobs: 1,
  },
  files: [
    "dist/**/*",
    "!dist/win-unpacked/**/*",
    "dist-server/**/*",
    "electron/**/*",
    "!electron/native/**/build/**/*",
    "vendor/**/*",
    "build/**/*",
    "package.json",
    "!node_modules/**/*",
  ],
  asarUnpack: [
    "dist-server/node_modules/**/*",
    "vendor/mpv/**/*",
    "electron/native/**/*.node",
  ],
  beforePack: "./scripts/before-pack.cjs",
  afterPack: "./scripts/after-pack.cjs",
  publish: [
    {
      provider: "github",
      owner: "YRRLYB",
      repo: "Aria",
      releaseType: "release",
    },
  ],
  win: {
    icon: "build/icon.ico",
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "Aria-${version}-${arch}.${ext}",
    shortcutName: "Aria",
    uninstallDisplayName: "Aria",
  },
  mac: {
    icon: "build/icon-1024.png",
    category: "public.app-category.music",
    darkModeSupport: true,
    minimumSystemVersion: "12.0",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
      {
        target: "zip",
        arch: ["x64", "arm64"],
      },
    ],
  },
  dmg: {
    artifactName: "Aria-${version}-${arch}.${ext}",
  },
  linux: {
    icon: "build/icon-1024.png",
    category: "AudioVideo",
    target: [
      {
        target: "AppImage",
        arch: ["x64"],
      },
    ],
  },
};

// Notarize only when the release environment provides Apple credentials.
// Without them electron-builder still produces an unsigned DMG that macOS
// users can open via right-click → Open.
if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) {
  config.mac.notarize = true;
}

// The local node_modules Electron build is host-specific. It is safe for the
// Windows x64 installer produced by our release script, but macOS builds must
// let electron-builder download the Electron distribution for each target
// architecture (x64 and arm64).
if (process.platform === "win32") {
  config.electronDist = path.join("node_modules", "electron", "dist");
}

module.exports = config;
