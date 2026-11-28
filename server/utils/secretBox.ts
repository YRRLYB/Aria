import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;
let cachedKeyPath: string | null = null;

function resolveSecretKey(keyFile = path.join(dataDir, ".secret-key")): Buffer {
  const envKey = process.env.ARIA_SECRET_KEY?.trim();
  if (envKey) {
    return crypto.createHash("sha256").update(envKey, "utf8").digest();
  }
  if (cachedKey && cachedKeyPath === keyFile) return cachedKey;

  try {
    if (fs.existsSync(keyFile)) {
      const raw = fs.readFileSync(keyFile, "utf8").trim();
      const buf = Buffer.from(raw, "base64");
      if (buf.byteLength === KEY_BYTES) {
        cachedKey = buf;
        cachedKeyPath = keyFile;
        return buf;
      }
    }
  } catch {
    // Regenerate key if unreadable.
  }

  const generated = crypto.randomBytes(KEY_BYTES);
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, `${generated.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Ephemeral fallback in read-only environments.
  }
  cachedKey = generated;
  cachedKeyPath = keyFile;
  return generated;
}

export function resetSecretBoxCache() {
  cachedKey = null;
  cachedKeyPath = null;
}

export function encryptSecret(plaintext: string, keyFile?: string): string {
  if (!plaintext) return "";
  if (plaintext.startsWith(PREFIX)) return plaintext;
  const key = resolveSecretKey(keyFile);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string, keyFile?: string): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret envelope");
  }
  const [ivB64, tagB64, cipherB64] = parts;
  const key = resolveSecretKey(keyFile);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
