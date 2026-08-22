import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("muse.toolDisplay configuration", () => {
  test("contributes Compact, Balanced, and Detailed with Compact as default", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const setting =
      pkg.contributes.configuration.properties["muse.toolDisplay"];

    expect(setting).toBeDefined();
    expect(setting.default).toBe("compact");
    expect(setting.enum).toEqual(["compact", "balanced", "detailed"]);
  });

  test("forwards the setting and reacts when it changes", () => {
    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");
    const extension = readFileSync(resolve("src/extension.ts"), "utf8");

    expect(provider).toContain('"toolDisplay"');
    expect(provider).toContain('"compact"');
    expect(extension).toContain(
      'e.affectsConfiguration("muse.toolDisplay")',
    );
  });
});
