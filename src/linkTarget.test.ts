import { describe, expect, test } from "bun:test";
import {
  classifyToolLink,
  resolveToolLinkPath,
  shouldOpenInBrowser,
} from "./linkTarget";

describe("linkTarget", () => {
  test("rejects javascript scheme", () => {
    expect(classifyToolLink("javascript:alert(1)")).toBeNull();
  });

  test("classifies https URLs", () => {
    expect(classifyToolLink("https://example.com/page.html")).toEqual({
      kind: "http",
      href: "https://example.com/page.html",
    });
  });

  test("classifies absolute file paths", () => {
    expect(classifyToolLink("/tmp/report.html")).toEqual({
      kind: "file",
      filePath: "/tmp/report.html",
    });
  });

  test("classifies relative paths with workspace", () => {
    expect(classifyToolLink("dist/index.html", "/Users/dev/project")).toEqual({
      kind: "relative",
      relativePath: "dist/index.html",
    });
  });

  test("resolves relative paths to absolute file paths", () => {
    const resolved = resolveToolLinkPath(
      "dist/index.html",
      "/Users/dev/project",
    );
    expect(resolved).toBe("/Users/dev/project/dist/index.html");
  });
});

describe("shouldOpenInBrowser", () => {
  test("true for http(s)", () => {
    expect(shouldOpenInBrowser("https://example.com/x")).toBe(true);
    expect(shouldOpenInBrowser("http://example.com/x")).toBe(true);
  });

  test("true for paths ending in html/htm", () => {
    expect(shouldOpenInBrowser("/tmp/report.html")).toBe(true);
    expect(shouldOpenInBrowser("/tmp/report.htm")).toBe(true);
    expect(shouldOpenInBrowser("file:///tmp/report.html")).toBe(true);
    expect(shouldOpenInBrowser("dist/index.html")).toBe(true);
    expect(shouldOpenInBrowser("/tmp/report.HTML")).toBe(true);
  });

  test("false for non-html local files", () => {
    expect(shouldOpenInBrowser("/tmp/notes.md")).toBe(false);
    expect(shouldOpenInBrowser("/tmp/data.json")).toBe(false);
    expect(shouldOpenInBrowser("src/app.ts")).toBe(false);
  });

  test("html path decision is independent of file:// prefix", () => {
    expect(shouldOpenInBrowser("/Users/marc/blt/ism/docs/ism-close-3d.html")).toBe(
      true,
    );
  });
});
