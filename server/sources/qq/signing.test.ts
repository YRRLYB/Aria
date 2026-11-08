import { describe, expect, it } from "vitest";
import { decodeAg1Request, decodeAg1Response, encodeAg1Request, encodeAg1Response, zzcSign } from "./signing";

describe("qq web signing", () => {
  it("matches the official zzc fixtures", () => {
    expect(zzcSign("123")).toBe("zzcec1b555gzqzg7laztguyjl2bu20r6x1w50c55f60");
    expect(zzcSign("hello world")).toBe("zzcfb3415bc4nfoxmd9uik71mkomtubjfjp141a1cbbcc");
    expect(zzcSign("jixun.uk")).toBe("zzcf47b78apso27mjjbbzgbof0szikfkvyqc7fc3a2b5");
  });

  it("decodes the ag-1 response fixture", () => {
    const fixture = Buffer.from(
      "AR3vcjr+DTBcYVz/bBhmrSIJHD7gCEvTaS25FTtcfVKpa0g9/mtCC2i7WFnqezj9SWwKKxjteVw6+2gJEg==",
      "base64",
    );
    expect(decodeAg1Response(new Uint8Array(fixture))).toBe(
      '{"code":0,"ts":0,"start_ts":100,"traceid":"ffffffffffffffff"}',
    );
    const text = '{"code":0,"req_0":{"code":0,"data":{"retCode":0}}}';
    expect(decodeAg1Response(encodeAg1Response(text))).toBe(text);
  });

  it("decrypts the official ag-1 request fixture and round-trips our own body", () => {
    const fixture = Buffer.from("UVKyyaPxYeBs+e6kkEeQpwwnsRmO4NI5JTdJvqrvU3w3elv4W1kcb8G35S4=", "base64");
    expect(decodeAg1Request(new Uint8Array(fixture))).toBe('{"hello":"ag1!"}');
    const text = JSON.stringify({ req_0: { module: "music.musicasset.PlaylistDetailWrite" } });
    const encrypted = encodeAg1Request(text);
    expect(encrypted.length).toBe(12 + Buffer.byteLength(text) + 16);
    expect(decodeAg1Request(encrypted)).toBe(text);
    expect(encrypted.equals(encodeAg1Request(text))).toBe(false);
  });
});
