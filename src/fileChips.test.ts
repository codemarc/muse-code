import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFileChips } from "./fileChips";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "muse-chips-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("buildFileChips", () => {
  test("only chips paths that exist on disk", () => {
    withRoot((root) => {
      const real = join(root, "report.md");
      writeFileSync(real, "# hi\n");
      const text = `wrote ${real} but not ${join(root, "ghost.md")}`;
      const chips = buildFileChips(text, root);
      expect(chips.map((c) => c.href)).toEqual([real]);
      expect(chips[0]?.name).toBe("report.md");
      expect(chips[0]?.label).toBe("Document · MD");
    });
  });

  test("skips placeholder paths from prose", () => {
    withRoot((root) => {
      const text =
        "typically <root>/sessions/YYYY/MM/DD/<session-id>/session.jsonl is the log";
      expect(buildFileChips(text, root)).toEqual([]);
    });
  });

  test("labels by extension and dedupes repeats", () => {
    withRoot((root) => {
      mkdirSync(join(root, "data"), { recursive: true });
      const log = join(root, "data", "session.jsonl");
      const sheet = join(root, "data", "book.xlsx");
      writeFileSync(log, '{"a":1}\n');
      writeFileSync(sheet, "x");
      const chips = buildFileChips(`${log} ${log} ${sheet}`, root);
      expect(chips.map((c) => c.label)).toEqual([
        "Document · JSONL",
        "Spreadsheet · XLSX",
      ]);
    });
  });

  test("ignores directories and web urls", () => {
    withRoot((root) => {
      mkdirSync(join(root, "notes.md"), { recursive: true });
      const chips = buildFileChips(
        `${join(root, "notes.md")} https://example.com/a.md`,
        root,
      );
      expect(chips).toEqual([]);
    });
  });

  test("resolves relative paths against the workspace root", () => {
    withRoot((root) => {
      mkdirSync(join(root, "docs"), { recursive: true });
      mkdirSync(join(root, ".trailz", "plans"), { recursive: true });
      writeFileSync(join(root, "docs", "STATUS.md"), "x");
      writeFileSync(join(root, ".trailz", "plans", "normalize.md"), "x");
      const chips = buildFileChips(
        "Status (docs/STATUS.md: today). Next: `.trailz/plans/normalize.md`.",
        root,
      );
      expect(chips.map((c) => c.href)).toEqual([
        join(root, "docs", "STATUS.md"),
        join(root, ".trailz", "plans", "normalize.md"),
      ]);
    });
  });

  test("caps the number of chips", () => {
    withRoot((root) => {
      const paths: string[] = [];
      for (let i = 0; i < 9; i += 1) {
        const p = join(root, `f${i}.md`);
        writeFileSync(p, "x");
        paths.push(p);
      }
      expect(buildFileChips(paths.join(" "), root, 4)).toHaveLength(4);
    });
  });
});
