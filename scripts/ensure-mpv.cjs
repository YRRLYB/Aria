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

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }

    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadFile(response.headers.location, destination, redirects + 1).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

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

async function main() {
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
