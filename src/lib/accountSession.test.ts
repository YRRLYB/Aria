import { describe, expect, it } from "vitest";
import { accountSessionChanged } from "./accountSession";

describe("account session identity", () => {
  it("invalidates work on sign-out or a different known account", () => {
    expect(accountSessionChanged({ connected: true, userId: "1" }, { connected: false, userId: null })).toBe(true);
    expect(accountSessionChanged({ connected: true, userId: "1" }, { connected: true, userId: "2" })).toBe(true);
    expect(accountSessionChanged({ connected: false, userId: null }, { connected: true, userId: "1" })).toBe(true);
  });

  it("keeps work when the same account's previously unknown id is filled in", () => {
    expect(accountSessionChanged(null, { connected: true, userId: "1" })).toBe(false);
    expect(accountSessionChanged({ connected: true, userId: null }, { connected: true, userId: "1" })).toBe(false);
    expect(accountSessionChanged({ connected: true, userId: "1" }, { connected: true, userId: "1" })).toBe(false);
  });
});
