// 从根目录 logo.png 生成全套应用图标：圆角方块（透明四角）。
// 产物：logo.png（2048）、build/icon-1024.png、build/icon.png（256）、build/icon.ico（多尺寸）。
// 用法：node scripts/generate-icons.cjs
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const source = path.join(root, "logo.png");
const buildDir = path.join(root, "build");

// 现代 app 图标通用的圆角比例（iOS / macOS Big Sur squircle ≈ 22.4%）。
const RADIUS_RATIO = 0.2237;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function roundedPng(size) {
  const radius = Math.round(size * RADIUS_RATIO);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`,
  );
  return sharp(source)
    .resize(size, size)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// ICO 容器：目录 + 条目表 + 直接内嵌 PNG（Vista+ 支持）。
function icoFromPngs(pngs) {
  const sizes = [...pngs.keys()].sort((a, b) => a - b);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  // 目录表在前连续排列，图片数据统一放在表后。
  const dir = [];
  const blobs = [];
  let offset = 6 + 16 * sizes.length;
  for (const size of sizes) {
    const data = pngs.get(size);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 表示 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dir.push(entry);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

(async () => {
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(source, await roundedPng(2048));
  fs.writeFileSync(path.join(buildDir, "icon-1024.png"), await roundedPng(1024));
  fs.writeFileSync(path.join(buildDir, "icon.png"), await roundedPng(256));

  const pngs = new Map();
  for (const size of ICO_SIZES) pngs.set(size, await roundedPng(size));
  fs.writeFileSync(path.join(buildDir, "icon.ico"), icoFromPngs(pngs));

  console.log("icons regenerated: logo.png, build/icon-1024.png, build/icon.png, build/icon.ico");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
