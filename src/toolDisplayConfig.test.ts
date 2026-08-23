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

  test("contributes expand-all and collapse-all view title commands", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const commands = pkg.contributes.commands as Array<{
      command: string;
      icon?: string;
    }>;
    const menus = pkg.contributes.menus["view/title"] as Array<{
      command: string;
      when?: string;
    }>;
    const extension = readFileSync(resolve("src/extension.ts"), "utf8");
    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "muse.expandAll",
          icon: "$(expand-all)",
        }),
        expect.objectContaining({
          command: "muse.collapseAll",
          icon: "$(collapse-all)",
        }),
      ]),
    );
    expect(menus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "muse.expandAll",
          when: "view == muse.chatView",
        }),
        expect.objectContaining({
          command: "muse.collapseAll",
          when: "view == muse.chatView",
        }),
      ]),
    );
    expect(extension).toContain('registerCommand("muse.expandAll"');
    expect(extension).toContain('registerCommand("muse.collapseAll"');
    expect(provider).toContain('"expandAll"');
    expect(provider).toContain('"collapseAll"');
  });
});
