import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildMpvArguments,
  NATIVE_AUDIO_CLIENT_NAME,
  NATIVE_AUDIO_PROCESS_NAME,
} = require("./mpvEngine.cjs");

describe("native mpv output", () => {
  it("keeps the WASAPI session identified as Aria", () => {
    const args = buildMpvArguments("\\\\.\\pipe\\aria-test");

    expect(args).toContain(`--audio-client-name=${NATIVE_AUDIO_CLIENT_NAME}`);
    expect(args).toContain(`--title=${NATIVE_AUDIO_CLIENT_NAME}`);
    expect(args).toContain(`--force-media-title=${NATIVE_AUDIO_CLIENT_NAME}`);
    expect(args).toContain("--ao=wasapi");
    expect(args).toContain("--audio-exclusive=no");
    expect(NATIVE_AUDIO_PROCESS_NAME).toBe(`${NATIVE_AUDIO_CLIENT_NAME}.exe`);
  });

  it("uses the same executable basename OOPZ selects for app loopback", () => {
    expect(NATIVE_AUDIO_PROCESS_NAME.toLowerCase()).toBe("aria.exe");
  });
});
