const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const outputNodeModules = path.join(rootDir, "dist-server", "node_modules");
const copiedPackages = new Set();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolvePackageDir(packageName, fromDir) {
  try {
    let currentDir = path.dirname(require.resolve(packageName, { paths: [fromDir] }));
    while (currentDir !== path.dirname(currentDir)) {
      const manifestPath = path.join(currentDir, "package.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = readJson(manifestPath);
        if (manifest.name === packageName) return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
  } catch {
    // Some packages export no package.json and no default entry.
  }

  let currentDir = fromDir;
  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "node_modules", ...packageName.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    currentDir = path.dirname(currentDir);
  }

  throw new Error(`Unable to resolve package directory for ${packageName}`);
}

function copyPackage(packageName, fromDir = rootDir) {
  const packageDir = resolvePackageDir(packageName, fromDir);
  const manifestPath = path.join(packageDir, "package.json");
  const manifest = readJson(manifestPath);
  const copyKey = `${manifest.name}@${manifest.version}:${packageDir}`;
  if (copiedPackages.has(copyKey)) return;
  copiedPackages.add(copyKey);

  const outputDir = path.join(outputNodeModules, ...manifest.name.split("/"));
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.cpSync(packageDir, outputDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.cache${path.sep}`),
  });

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };

  for (const dependencyName of Object.keys(dependencies)) {
    copyPackage(dependencyName, packageDir);
  }
}

copyPackage("NeteaseCloudMusicApi");
console.log(`Copied ${copiedPackages.size} NetEase runtime packages.`);
