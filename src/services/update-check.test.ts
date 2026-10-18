import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./update-check";

describe("isNewerVersion", () => {
  it("compares major, minor and patch numerically", () => {
    expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("v0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
  });

  it("treats equal versions as up to date", () => {
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
  });

  it("ignores unparseable tags", () => {
    expect(isNewerVersion("nightly", "0.1.0")).toBe(false);
  });
});
