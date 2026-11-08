import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * QQ 音乐官网写接口（红心 / 歌单）的签名与加密。
 *
 * 读接口仍然走 musicu.fcg；`PlaylistDetailWrite` 之类的写操作会被
 * needSign 分支拦到 musics.fcg，必须同时做两件事：
 *   1. 对原始 JSON 做 zzc 签名（SHA-1 混淆）；
 *   2. 用 AES-128-GCM（encoding=ag-1）加密请求体，响应再用固定 key XOR。
 * 只签名不加密、或只加密不签名，上游都会回 80105。
 *
 * 协议来源（MIT）：github.com/jixunmoe/qmweb-sign
 */

const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

const AG1_REQUEST_KEY = Buffer.from([189, 48, 95, 16, 208, 255, 116, 182, 239, 84, 218, 184, 53, 181, 225, 207]);
const AG1_RESPONSE_KEY = Buffer.from([
  122, 63, 140, 29, 94, 155, 47, 10, 108, 77, 126, 139, 31, 58, 92, 157, 14, 43, 111, 74, 129,
]);

function pickHashByIdx(hash: string, indexes: number[]) {
  return indexes.map((idx) => hash[idx]).join("");
}

/** `zzc...` 签名，大小写与官网一致（全小写）。 */
export function zzcSign(text: string): string {
  const hash = createHash("sha1").update(Buffer.from(text, "utf-8")).digest("hex").toUpperCase();
  const part1 = pickHashByIdx(hash, PART_1_INDEXES);
  const part2 = pickHashByIdx(hash, PART_2_INDEXES);
  const part3 = SCRAMBLE_VALUES.map((value, index) => value ^ Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16));
  const b64Part = Buffer.from(part3).toString("base64").replace(/[\\/+=]/g, "");
  return `zzc${part1}${b64Part}${part2}`.toLowerCase();
}

/**
 * ag-1 请求体：12 字节随机 IV + AES-128-GCM 密文 + 16 字节 authTag。
 * 官网和 qmweb-sign 都会把这段二进制再 base64 成文本塞进 `text/plain`
 * body；直接发原始字节会被 musics.fcg 以 2001 拒掉。
 */
export function encodeAg1RequestRaw(text: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", AG1_REQUEST_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf-8"), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([iv, encrypted]);
}

export function encodeAg1Request(text: string): string {
  return encodeAg1RequestRaw(text).toString("base64");
}

/** 仅测试/诊断用：解开 ag-1 请求体，核对 IV、密文与 authTag 的拼接顺序。 */
export function decodeAg1Request(data: string | ArrayBuffer | Uint8Array): string {
  const bytes = typeof data === "string"
    ? Buffer.from(data, "base64")
    : data instanceof Uint8Array
      ? data
      : new Uint8Array(data);
  if (bytes.length < 12 + 16) throw new Error("ag-1 request body is too short");
  const iv = bytes.subarray(0, 12);
  const authTag = bytes.subarray(bytes.length - 16);
  const encrypted = bytes.subarray(12, bytes.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", AG1_REQUEST_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
}

/** ag-1 响应是明文 JSON 与固定 21 字节 key 的循环 XOR。 */
export function decodeAg1Response(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    decoded[index] = bytes[index] ^ AG1_RESPONSE_KEY[index % AG1_RESPONSE_KEY.length];
  }
  return new TextDecoder().decode(decoded);
}

/** 仅测试与本地诊断用：把明文 JSON 变成 ag-1 响应字节。 */
export function encodeAg1Response(text: string): Buffer {
  const bytes = Buffer.from(text, "utf-8");
  const encoded = Buffer.alloc(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    encoded[index] = bytes[index] ^ AG1_RESPONSE_KEY[index % AG1_RESPONSE_KEY.length];
  }
  return encoded;
}
