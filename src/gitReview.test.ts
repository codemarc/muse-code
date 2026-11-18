import { describe, expect, test } from "bun:test";
import {
  filesChangedSince,
  formatReviewMarkdown,
  parsePorcelain,
  parsePorcelainZ,
  readGitSnapshot,
  reviewSince,
} from "./gitReview";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("NUL porcelain keeps Unicode, spaces and literal arrows in paths", () => {
  expect(parsePorcelainZ(" M Türkçe -> dosya.ts\0R  new name.ts\0old name.ts\0?? a b.ts\0")).toEqual([
    { path: "Türkçe -> dosya.ts", status: "M" }, { path: "new name.ts", status: "R" }, { path: "a b.ts", status: "??" },
  ]);
});

test("detects further edits to already-dirty and already-untracked files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muse-review-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  };
  try {
    git("init");
    await writeFile(join(cwd, "tracked.ts"), "baseline\n");
    git("add", "tracked.ts");
    git("-c", "user.name=Muse Test", "-c", "user.email=muse@example.invalid", "commit", "-m", "baseline");
    await writeFile(join(cwd, "tracked.ts"), "user edit\n");
    await writeFile(join(cwd, "Türkçe new.ts"), "new before\n");
    const before = await readGitSnapshot(cwd);
    expect((await reviewSince(cwd, before)).files).toEqual([]);
    await writeFile(join(cwd, "tracked.ts"), "Muse edit\n");
    await writeFile(join(cwd, "Türkçe new.ts"), "new after\n");
    const review = await reviewSince(cwd, before);
    expect(review.files.map((f) => f.path).sort()).toEqual(["Türkçe new.ts", "tracked.ts"].sort());
    expect(review.diff).toContain("+Muse edit");
    const dirty = await readGitSnapshot(cwd);
    await writeFile(join(cwd, "tracked.ts"), "baseline\n");
    expect((await reviewSince(cwd, dirty)).files).toContainEqual({ path: "tracked.ts", status: "clean" });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

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
