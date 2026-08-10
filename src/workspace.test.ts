import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectWorkspaceRoot, normalizeWorkspacePath } from "./workspace";

describe("normalizeWorkspacePath", () => {
  test("strips trailing slashes", () => {
    expect(normalizeWorkspacePath("/tmp/proj/")).toBe("/tmp/proj");
    expect(normalizeWorkspacePath("/tmp/proj///")).toBe("/tmp/proj");
  });
});

describe("inspectWorkspaceRoot", () => {
  test("accepts a real directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-ws-"));
    const result = inspectWorkspaceRoot(dir);
    expect(result).toEqual({ ok: true, path: dir });
  });

  test("accepts directory with trailing slash", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-ws-"));
    const result = inspectWorkspaceRoot(dir + "/");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(dir);
    }
  });

  test("rejects a symlink directory root", () => {
    const base = mkdtempSync(join(tmpdir(), "muse-ws-"));
    const real = join(base, "real");
    const link = join(base, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    const result = inspectWorkspaceRoot(link);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("symlink");
      expect(result.error).toContain("Open the real directory");
    }
  });

  test("rejects a file path", () => {
    const base = mkdtempSync(join(tmpdir(), "muse-ws-"));
    const file = join(base, "file.txt");
    writeFileSync(file, "x");
    const result = inspectWorkspaceRoot(file);
    expect(result.ok).toBe(false);
  });

  test("rejects missing path", () => {
    const result = inspectWorkspaceRoot("/no/such/muse-workspace-root-xyz");
    expect(result.ok).toBe(false);
  });
});
