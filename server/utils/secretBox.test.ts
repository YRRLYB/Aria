import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, resetSecretBoxCache } from "./secretBox";

let dir = "";

afterEach(async () => {
  resetSecretBoxCache();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

describe("secretBox", () => {
  it("encrypts and decrypts secrets cleanly with AES-256-GCM", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aria-secretbox-"));
    const keyFile = path.join(dir, ".secret-key");

    const encrypted = encryptSecret("my-super-secret-password", keyFile);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("my-super-secret-password");
    expect(decryptSecret(encrypted, keyFile)).toBe("my-super-secret-password");

    const storedKey = await readFile(keyFile, "utf8");
    expect(Buffer.from(storedKey.trim(), "base64").byteLength).toBe(32);
  });

  it("rejects tampered ciphertexts", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aria-secretbox-"));
    const keyFile = path.join(dir, ".secret-key");
    const encrypted = encryptSecret("token-1234", keyFile);
    const tampered = `${encrypted.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered, keyFile)).toThrow();
  });
});
