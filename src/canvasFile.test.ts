import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isUnderWorkspace,
  MAX_CANVAS_FILE_BYTES,
  readCanvasFile,
} from "./canvasFile";

describe("isUnderWorkspace", () => {
  test("accepts children", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-canvas-jail-"));
    try {
      const child = join(root, "docs", "a.md");
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(child, "# hi\n");
      expect(isUnderWorkspace(child, root)).toBe(true);
      expect(isUnderWorkspace(root, root)).toBe(true);
      expect(isUnderWorkspace("/tmp", root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readCanvasFile", () => {
  test("reads utf8 file inside workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-canvas-read-"));
    try {
      const file = join(root, "note.md");
      writeFileSync(file, "# Hello\n");
      const result = readCanvasFile(file, root);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.kind).toBe("markdown");
        expect(result.source).toContain("# Hello");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects paths outside workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-canvas-out-"));
    const outside = mkdtempSync(join(tmpdir(), "muse-canvas-outside-"));
    try {
      const file = join(outside, "secret.md");
      writeFileSync(file, "nope\n");
      const result = readCanvasFile(file, root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("outside");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects oversized files", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-canvas-big-"));
    try {
      const file = join(root, "big.txt");
      writeFileSync(file, "x".repeat(MAX_CANVAS_FILE_BYTES + 1));
      const result = readCanvasFile(file, root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("larger");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("xlsx is external-only", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-canvas-xls-"));
    try {
      const file = join(root, "sheet.xlsx");
      writeFileSync(file, "not-really-xlsx");
      const result = readCanvasFile(file, root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("externally");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
