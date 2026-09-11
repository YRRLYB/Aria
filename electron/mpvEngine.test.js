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

  it("starts a fresh exclusive WASAPI session when requested", () => {
    const args = buildMpvArguments("\\\\.\\pipe\\aria-exclusive-test", true);

    expect(args).toContain("--audio-exclusive=yes");
    expect(args).not.toContain("--audio-exclusive=no");
  });

  it("keeps shared and exclusive output flags mutually exclusive", () => {
    const shared = buildMpvArguments("\\\\.\\pipe\\aria-shared-test", false);
    const exclusive = buildMpvArguments("\\\\.\\pipe\\aria-exclusive-test-2", true);

    expect(shared).toContain("--audio-exclusive=no");
    expect(exclusive).toContain("--audio-exclusive=yes");
    expect(shared).not.toContain("--audio-exclusive=yes");
    expect(exclusive).not.toContain("--audio-exclusive=no");
  });

  it("uses the same executable basename OOPZ selects for app loopback", () => {
    expect(NATIVE_AUDIO_PROCESS_NAME.toLowerCase()).toBe("aria.exe");
  });
});
