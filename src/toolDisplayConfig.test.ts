import { describe, expect, test } from "bun:test";
import { activeChatViewId, supportsSecondarySidebar } from "./viewLocation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("muse.toolDisplay configuration", () => {
  test("contributes Minimal, Compact, Balanced, and Detailed with Compact as default", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const setting =
      pkg.contributes.configuration.properties["muse.toolDisplay"];

    expect(setting).toBeDefined();
    expect(setting.default).toBe("compact");
    expect(setting.enum).toEqual(["minimal", "compact", "balanced", "detailed"]);
    expect(setting.enumDescriptions[0]).toContain("working pulse");
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

  test("puts the chat in the secondary side bar where supported, activity bar otherwise", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const containers = pkg.contributes.viewsContainers;
    // Same pattern as Codex / Claude Code: both containers are declared and a
    // context key picks one. Cursor and VS Code < 1.106 get the activity bar.
    expect(containers.secondarySidebar).toEqual([
      expect.objectContaining({ id: "muse-secondary", when: "!muse.doesNotSupportSecondarySidebar" }),
    ]);
    expect(containers.activitybar).toEqual([
      expect.objectContaining({ id: "muse-activity", when: "muse.doesNotSupportSecondarySidebar" }),
    ]);
    const containerIds = new Set(
      Object.values(containers).flatMap((list) =>
        (list as Array<{ id: string }>).map((c) => c.id),
      ),
    );
    for (const [containerId, views] of Object.entries(pkg.contributes.views)) {
      expect(containerIds.has(containerId)).toBe(true);
      for (const view of views as Array<{ id: string; when?: string }>) {
        expect(view.id).toMatch(/^muse\.chatView/);
        expect(view.when).toBeDefined();
      }
    }
    expect(pkg.contributes.views["muse-activity"].map((v: { id: string }) => v.id)).toEqual(["muse.chatView"]);
    expect(pkg.contributes.views["muse-secondary"].map((v: { id: string }) => v.id)).toEqual([
      "muse.chatViewSecondary",
    ]);

    const extension = readFileSync(resolve("src/extension.ts"), "utf8");
    expect(extension).toContain("registerWebviewViewProvider(ChatViewProvider.viewType");
    expect(extension).toContain("registerWebviewViewProvider(SECONDARY_VIEW_ID");
    expect(extension).toContain("NO_SECONDARY_CONTEXT_KEY");
  });

  test("detects secondary side bar support like Codex / Claude Code", () => {
    expect(supportsSecondarySidebar("1.106.0", "Visual Studio Code")).toBe(true);
    expect(supportsSecondarySidebar("1.146.0", "Visual Studio Code")).toBe(true);
    expect(supportsSecondarySidebar("2.0.0", "Visual Studio Code - Insiders")).toBe(true);
    expect(supportsSecondarySidebar("1.105.1", "Visual Studio Code")).toBe(false);
    expect(supportsSecondarySidebar("1.150.0", "Cursor")).toBe(false);
    expect(activeChatViewId("1.146.0", "Visual Studio Code")).toBe("muse.chatViewSecondary");
    expect(activeChatViewId("1.99.0", "VSCodium")).toBe("muse.chatView");
  });

  test("editor title has a one-click chat toggle", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(pkg.contributes.menus["editor/title"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: "muse.toggleChat", group: "navigation@100" })]),
    );
  });

  test("wires file mentions and post-turn git review", () => {
    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");
    expect(provider).toContain('"mentionQuery"');
    expect(provider).toContain("handleMentionQuery");
    expect(provider).toContain("postTurnReviews");
    expect(provider).toContain("checkpoints.finish");
    expect(provider).toContain('id="mentions"');
    expect(provider).toContain("openTurnDiff");
  });

  test("activates at startup so the status bar shows without opening chat", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(pkg.activationEvents).toEqual(
      expect.arrayContaining(["onStartupFinished"]),
    );

    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");
    expect(provider).toContain("createStatusBarItem(");
    expect(provider).toContain("this.refreshStatusBar();");
  });

  test("contributes a default shortcut for opening the editor panel", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const keybindings = (pkg.contributes.keybindings ?? []) as Array<{
      command: string;
      key?: string;
      mac?: string;
      when?: string;
    }>;

    // No `when`: a global launcher. The chord is unused by VS Code/Cursor
    // defaults and by every installed extension's manifest.
    expect(keybindings).toEqual(
      expect.arrayContaining([
        {
          command: "muse.openPanel",
          key: "ctrl+shift+r",
          mac: "cmd+shift+r",
        },
      ]),
    );
  });

  test("contributes and forwards the explicit execution mode", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const setting =
      pkg.contributes.configuration.properties["muse.executionMode"];
    expect(setting.default).toBe("panel");
    expect(setting.enum).toEqual(["headless", "interactive", "panel", "windows"]);

    const provider = readFileSync(resolve("src/chatViewProvider.ts"), "utf8");
    const extension = readFileSync(resolve("src/extension.ts"), "utf8");
    expect(provider).toContain('"executionMode"');
    expect(extension).toContain('"muse.executionMode"');
  });
});
