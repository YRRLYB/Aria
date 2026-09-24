import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./utils/paths";

// Remote access lets a phone (Aria mobile) reach this server over the LAN.
// Config lives in <dataDir>/remote.json and is written either by the desktop
// app (settings toggle) or by hand for standalone server usage. When enabled
// the server binds 0.0.0.0 and every /api request must carry the token unless
// it originates from the loopback interface (the desktop's own renderer).

export type RemoteAccessConfig = {
  enabled: boolean;
  token: string;
};

const remoteAccessFile = path.join(dataDir, "remote.json");

function envEnabled(): boolean | null {
  const raw = process.env.ARIA_REMOTE_ENABLED;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return null;
}

export function generateRemoteToken(): string {
  return randomBytes(16).toString("base64url");
}

export function loadRemoteAccessConfig(): RemoteAccessConfig {
  const config: RemoteAccessConfig = { enabled: false, token: "" };
  try {
    const parsed = JSON.parse(readFileSync(remoteAccessFile, "utf8")) as Partial<RemoteAccessConfig>;
    if (typeof parsed.enabled === "boolean") config.enabled = parsed.enabled;
    if (typeof parsed.token === "string") config.token = parsed.token;
  } catch {
    // Missing or unreadable file: defaults below apply.
  }

  const envToggle = envEnabled();
  if (envToggle !== null) config.enabled = envToggle;
  const envToken = process.env.ARIA_REMOTE_TOKEN;
  if (envToken) config.token = envToken;

  // A standalone server that is told to enable remote access without a token
  // mints one so the QR/manual pairing flow always has something to show.
  if (config.enabled && !config.token) config.token = generateRemoteToken();
  return config;
}

export function loopbackAddress(requested: string | undefined): boolean {
  if (!requested) return false;
  return (
    requested === "127.0.0.1" ||
    requested === "::1" ||
    requested === "::ffff:127.0.0.1" ||
    requested.endsWith(".127.0.0.1")
  );
}

export function extractRequestToken(headers: { authorization?: string }, queryToken: unknown): string {
  const header = headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return typeof queryToken === "string" ? queryToken : "";
}

export function matchesRemoteToken(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}
