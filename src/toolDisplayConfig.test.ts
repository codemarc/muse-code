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
          when: "view =~ /muse\\.chatView/",
        }),
        expect.objectContaining({
          command: "muse.collapseAll",
          when: "view =~ /muse\\.chatView/",
        }),
      ]),
    );
    expect(extension).toContain('registerCommand("muse.expandAll"');
    expect(extension).toContain('registerCommand("muse.collapseAll"');
    expect(provider).toContain('"expandAll"');
    expect(provider).toContain('"collapseAll"');
  });

  test("contributes a muse.ai title command and webview handoff", () => {
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
          command: "muse.openMuseAi",
          icon: "$(link-external)",
        }),
      ]),
    );
    expect(menus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "muse.openMuseAi",
          when: "view =~ /muse\\.chatView/",
        }),
      ]),
    );
    expect(extension).toContain('registerCommand("muse.openMuseAi"');
    expect(extension).toContain("provider.openMuseAi()");
    expect(provider).toContain('"openMuseAi"');
    expect(provider).toContain('id="muse-ai"');
    expect(provider).toContain("clipboard.writeText");
    expect(provider).toContain("MUSE_AI_URL");
    expect(provider).toContain("transcriptToMarkdown");
    expect(extension).toContain(
      "https://developer.meta.com/ai/products/muse-code/",
    );
  });

  test("contributes the aligned chat placement options", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const location = pkg.contributes.configuration.properties["muse.preferredLocation"];
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);

    expect(location.default).toBe("secondarySidebar");
    expect(location.enum).toEqual(["secondarySidebar", "panel", "terminal"]);
    expect(commands).toEqual(expect.arrayContaining([
      "muse.openPanel",
      "muse.openSecondarySidebar",
      "muse.openNewWindow",
    ]));
  });

  test("wires file mentions and post-turn git review", () => {
    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");
    expect(provider).toContain('"mentionQuery"');
    expect(provider).toContain("handleMentionQuery");
    expect(provider).toContain("publishTurnReview");
    expect(provider).toContain("reviewSince");
    expect(provider).toContain('id="mentions"');
    expect(provider).toContain("Changed files");
  });

  test("contributes and forwards the explicit execution mode", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const setting =
      pkg.contributes.configuration.properties["muse.executionMode"];
    expect(setting.default).toBe("headless");
    expect(setting.enum).toEqual(["headless", "interactive"]);

    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");
    const extension = readFileSync(resolve("src/extension.ts"), "utf8");
    expect(provider).toContain('"executionMode"');
    expect(extension).toContain('"muse.executionMode"');
  });
});
