import { describe, expect, test } from "bun:test";
import { matchStoredFolder } from "./workspaceFolderMatch";

function folder(name: string, path: string) {
  return { name, fsPath: path, uriString: `file://${path}` };
}

describe("matchStoredFolder", () => {
  test("returns undefined when empty", () => {
    expect(matchStoredFolder([], undefined)).toBeUndefined();
  });

  test("auto-selects single root", () => {
    const only = folder("app", "/tmp/app");
    const result = matchStoredFolder([only], undefined);
    expect(result?.fsPath).toBe("/tmp/app");
    expect(result?.name).toBe("app");
  });

  test("multi-root needs stored uri", () => {
    const a = folder("a", "/tmp/a");
    const b = folder("b", "/tmp/b");
    expect(matchStoredFolder([a, b], undefined)).toBeUndefined();
  });

  test("multi-root matches stored uri", () => {
    const a = folder("a", "/tmp/a");
    const b = folder("b", "/tmp/b");
    const result = matchStoredFolder([a, b], "file:///tmp/b");
    expect(result?.name).toBe("b");
  });

  test("stale stored uri returns undefined in multi-root", () => {
    const a = folder("a", "/tmp/a");
    const b = folder("b", "/tmp/b");
    expect(matchStoredFolder([a, b], "file:///tmp/gone")).toBeUndefined();
  });
});
