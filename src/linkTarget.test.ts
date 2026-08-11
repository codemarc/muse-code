import { describe, expect, test } from "bun:test";
import { classifyToolLink, resolveToolLinkPath } from "./linkTarget";

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
