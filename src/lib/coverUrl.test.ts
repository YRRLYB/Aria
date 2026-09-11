import { expect, it } from "vitest";
import { sizedCoverUrl } from "./coverUrl";

it("requests bounded local covers while preserving existing query parameters", () => {
  expect(sizedCoverUrl("http://localhost/api/library/tracks/one/cover?v=2&size=768", 320))
    .toBe("http://localhost/api/library/tracks/one/cover?v=2&size=320");
  expect(sizedCoverUrl("data:image/png;base64,aaa", 320)).toBe("data:image/png;base64,aaa");
  expect(sizedCoverUrl(undefined, 320)).toBeUndefined();
});
