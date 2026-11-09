const fs = require("node:fs");

// Minimal Mach-O inspector used by the macOS packaging pipeline and the native
// decoder probe. It never executes a downloaded binary, so it can verify an
// arm64 build from an Intel host (and vice versa) during cross-architecture
// packaging.

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const PLATFORM_MACOS = 1;

const CPU_ARCH_ABI64 = 0x01000000;
const CPU_TYPE_X86 = 7;
const CPU_TYPE_ARM = 12;

function cpuArch(cputype) {
  const type = cputype >>> 0;
  if (type === (CPU_TYPE_X86 | CPU_ARCH_ABI64)) return "x64";
  if (type === (CPU_TYPE_ARM | CPU_ARCH_ABI64)) return "arm64";
  if (type === CPU_TYPE_X86) return "ia32";
  if (type === CPU_TYPE_ARM) return "arm";
  if (type === 0x0200000c) return "arm64_32";
  return `cpu:${type.toString(16)}`;
}

function decodeVersion(value) {
  const major = value >>> 16;
  const minor = (value >>> 8) & 0xff;
  const patch = value & 0xff;
  return `${major}.${minor}.${patch}`;
}

function inspectThin(buffer, offset = 0) {
  if (offset + 28 > buffer.length) return null;
  const magicLE = buffer.readUInt32LE(offset);
  const bigEndian = magicLE === 0xcefaedfe || magicLE === 0xcffaedfe;
  const magic = bigEndian ? buffer.readUInt32BE(offset) : magicLE;
  const is64 = magic === MH_MAGIC_64;
  if (!is64 && magic !== MH_MAGIC) return null;
  const readU32 = (position) => (bigEndian ? buffer.readUInt32BE(position) : buffer.readUInt32LE(position));
  const cputype = readU32(offset + 4);
  const ncmds = readU32(offset + 16);
  const headerSize = is64 ? 32 : 28;
  let commandOffset = offset + headerSize;
  let minOS = null;
  let sdk = null;
  for (let index = 0; index < ncmds; index += 1) {
    if (commandOffset + 8 > buffer.length) break;
    const cmd = readU32(commandOffset);
    const size = readU32(commandOffset + 4);
    if (size < 8 || commandOffset + size > buffer.length) break;
    if (cmd === LC_BUILD_VERSION && size >= 24) {
      const platform = readU32(commandOffset + 8);
      if (platform === PLATFORM_MACOS) {
        minOS = decodeVersion(readU32(commandOffset + 12));
        sdk = decodeVersion(readU32(commandOffset + 16));
      }
    } else if (cmd === LC_VERSION_MIN_MACOSX && size >= 16) {
      minOS = decodeVersion(readU32(commandOffset + 8));
      sdk = decodeVersion(readU32(commandOffset + 12));
    }
    commandOffset += size;
  }
  return { arch: cpuArch(cputype), cputype: cputype >>> 0, minOS, sdk };
}

function inspectBuffer(buffer) {
  if (buffer.length < 8) return null;
  const magicBE = buffer.readUInt32BE(0);
  if (magicBE === FAT_MAGIC || magicBE === FAT_MAGIC_64) {
    const fat64 = magicBE === FAT_MAGIC_64;
    const count = buffer.readUInt32BE(4);
    if (!count || count > 32) return null;
    const entrySize = fat64 ? 32 : 20;
    const tableEnd = 8 + count * entrySize;
    if (tableEnd > buffer.length) return null;
    const slices = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 8 + index * entrySize;
      const cputype = buffer.readUInt32BE(entry);
      const offset = fat64 ? Number(buffer.readBigUInt64BE(entry + 8)) : buffer.readUInt32BE(entry + 8);
      const size = fat64 ? Number(buffer.readBigUInt64BE(entry + 16)) : buffer.readUInt32BE(entry + 12);
      if (offset >= buffer.length) continue;
      const slice = inspectThin(buffer, offset);
      slices.push({
        arch: slice?.arch ?? cpuArch(cputype),
        cputype,
        minOS: slice?.minOS ?? null,
        sdk: slice?.sdk ?? null,
        offset,
        size,
      });
    }
    return { format: fat64 ? "fat64" : "fat", slices, archs: slices.map((slice) => slice.arch) };
  }

  const thin = inspectThin(buffer, 0);
  if (!thin) return null;
  return { format: "thin", slices: [{ ...thin, offset: 0, size: buffer.length }], archs: [thin.arch] };
}

function inspectMachO(filePath) {
  return inspectBuffer(fs.readFileSync(filePath));
}

function describe(info) {
  if (!info) return "not a Mach-O binary";
  return info.slices.map((slice) => `${slice.arch}${slice.minOS ? ` (macOS ${slice.minOS})` : ""}`).join(", ");
}

function assertMacBinary(filePath, expectedArch, label = filePath) {
  const info = inspectMachO(filePath);
  if (!info) {
    throw new Error(`${label} is not a Mach-O binary: ${filePath}`);
  }
  const expected = expectedArch === "universal" ? ["x64", "arm64"] : [expectedArch];
  const missing = expected.filter((arch) => !info.archs.includes(arch));
  if (missing.length) {
    throw new Error(`${label} architecture mismatch: expected ${expected.join("+")}, got ${describe(info)} (${filePath})`);
  }
  return info;
}

module.exports = {
  inspectMachO,
  inspectBuffer,
  assertMacBinary,
  describe,
};
