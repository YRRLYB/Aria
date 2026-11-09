import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import macho from "./macho.cjs";

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

function thin(arch, minOS = { major: 11, minor: 0, patch: 0 }) {
  const buffer = Buffer.alloc(32 + 24);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(arch === "arm64" ? CPU_TYPE_ARM64 : CPU_TYPE_X86_64, 4);
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt32LE(0, 12);
  buffer.writeUInt32LE(1, 16);
  buffer.writeUInt32LE(24, 20);
  buffer.writeUInt32LE(0, 24);
  buffer.writeUInt32LE(0x32, 32);
  buffer.writeUInt32LE(24, 36);
  buffer.writeUInt32LE(1, 40);
  buffer.writeUInt32LE((minOS.major << 16) | (minOS.minor << 8) | minOS.patch, 44);
  buffer.writeUInt32LE((15 << 16) | (5 << 8), 48);
  return buffer;
}

function fat(slices) {
  const headerSize = 8 + slices.length * 20;
  const offsets = [];
  let cursor = headerSize;
  for (const slice of slices) {
    offsets.push(cursor);
    cursor += slice.buffer.length;
  }
  const buffer = Buffer.alloc(cursor);
  buffer.writeUInt32BE(0xcafebabe, 0);
  buffer.writeUInt32BE(slices.length, 4);
  slices.forEach((slice, index) => {
    const entry = 8 + index * 20;
    buffer.writeUInt32BE(slice.arch === "arm64" ? CPU_TYPE_ARM64 : CPU_TYPE_X86_64, entry);
    buffer.writeUInt32BE(0, entry + 4);
    buffer.writeUInt32BE(offsets[index], entry + 8);
    buffer.writeUInt32BE(slice.buffer.length, entry + 12);
    buffer.writeUInt32BE(0, entry + 16);
    slice.buffer.copy(buffer, offsets[index]);
  });
  return buffer;
}

describe("Mach-O inspector", () => {
  it("reads thin Intel and Apple Silicon binaries", () => {
    const x64 = macho.inspectBuffer(thin("x64"));
    const arm64 = macho.inspectBuffer(thin("arm64"));
    expect(x64.archs).toEqual(["x64"]);
    expect(arm64.archs).toEqual(["arm64"]);
    expect(x64.slices[0].minOS).toBe("11.0.0");
  });

  it("reads universal binaries and verifies both slices", () => {
    const info = macho.inspectBuffer(fat([
      { arch: "x64", buffer: thin("x64") },
      { arch: "arm64", buffer: thin("arm64") },
    ]));
    expect(info.archs).toEqual(["x64", "arm64"]);

    const dir = mkdtempSync(join(tmpdir(), "aria-macho-"));
    try {
      const file = join(dir, "universal.node");
      writeFileSync(file, fat([
        { arch: "x64", buffer: thin("x64") },
        { arch: "arm64", buffer: thin("arm64") },
      ]));
      expect(macho.assertMacBinary(file, "universal").archs).toEqual(["x64", "arm64"]);
      expect(() => macho.assertMacBinary(file, "x64")).not.toThrow();
      const wrong = join(dir, "x64.node");
      writeFileSync(wrong, thin("x64"));
      expect(() => macho.assertMacBinary(wrong, "arm64")).toThrow(/architecture mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
