import { describe, expect, test } from "bun:test";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform";

describe("platform", () => {
  test("supports darwin, linux and win32", () => {
    expect(isSupportedPlatform("darwin")).toBe(true);
    expect(isSupportedPlatform("linux")).toBe(true);
    expect(isSupportedPlatform("win32")).toBe(true);
    expect(isSupportedPlatform("freebsd")).toBe(false);
  });

  test("message names the platform", () => {
    expect(unsupportedPlatformMessage("freebsd")).toContain("freebsd");
  });
});
