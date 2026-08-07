import { describe, expect, test } from "bun:test";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform";

describe("platform", () => {
  test("supports darwin and linux", () => {
    expect(isSupportedPlatform("darwin")).toBe(true);
    expect(isSupportedPlatform("linux")).toBe(true);
    expect(isSupportedPlatform("win32")).toBe(false);
  });

  test("message names the platform", () => {
    expect(unsupportedPlatformMessage("win32")).toContain("win32");
  });
});
