import { describe, expect, test } from "bun:test";
import {
  filesChangedSince,
  formatReviewMarkdown,
  parsePorcelain,
} from "./gitReview";

describe("parsePorcelain", () => {
  test("parses modified, untracked, and renamed paths", () => {
    const files = parsePorcelain(
      [
        " M src/chat.js",
        "?? media/new.css",
        "R  old.ts -> src/fileMentions.ts",
      ].join("\n"),
    );
    expect(files).toEqual([
      { path: "src/chat.js", status: "M" },
      { path: "media/new.css", status: "??" },
      { path: "src/fileMentions.ts", status: "R" },
    ]);
  });

  test("returns empty for blank output", () => {
    expect(parsePorcelain("")).toEqual([]);
    expect(parsePorcelain("\n")).toEqual([]);
  });
});

describe("filesChangedSince", () => {
  test("keeps paths that appeared or changed status this turn", () => {
    const before = parsePorcelain(" M already.ts\n");
    const after = parsePorcelain(" M already.ts\n M src/chat.js\n?? new.md\n");
    expect(filesChangedSince(before, after)).toEqual([
      { path: "src/chat.js", status: "M" },
      { path: "new.md", status: "??" },
    ]);
  });
});

describe("formatReviewMarkdown", () => {
  test("summarizes files and includes the diff body", () => {
    const md = formatReviewMarkdown(
      [
        { path: "src/chat.js", status: "M" },
        { path: "new.md", status: "??" },
      ],
      "diff --git a/src/chat.js b/src/chat.js\n+hi\n",
    );
    expect(md).toContain("# Changed files");
    expect(md).toContain("`src/chat.js`");
    expect(md).toContain("untracked");
    expect(md).toContain("+hi");
    expect(md).not.toContain("Accept");
    expect(md).not.toContain("Reject");
  });

  test("returns empty when nothing changed", () => {
    expect(formatReviewMarkdown([], "")).toBe("");
  });
});
