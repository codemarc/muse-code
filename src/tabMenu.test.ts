import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Muse CLI Chat: Open menus", () => {
  test("contributes Muse CLI Chat: Open to every tab via editor/title", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const commands = pkg.contributes.commands as Array<{
      command: string;
      title?: string;
      icon?: string;
    }>;
    const editorTitle = pkg.contributes.menus["editor/title"] as Array<{
      command: string;
      group?: string;
      when?: string;
    }>;
    const palette = pkg.contributes.menus.commandPalette as Array<{
      command: string;
      when?: string;
    }>;
    const extension = readFileSync(resolve("src/extension.ts"), "utf8");

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "muse.open",
          title: "Muse CLI Chat: Open",
          icon: "$(comment-discussion)",
        }),
      ]),
    );
    // No `when`, so Cursor/VS Code show it on every tab's context menu,
    // mirroring Claude Code's and Codex's unconditional editor/title entries.
    // First in the list, so it sits at the top like theirs.
    expect(editorTitle[0]).toEqual({
      command: "muse.open",
      group: "navigation",
    });
    // Hidden from the palette: muse.openChat already covers palette entry.
    expect(palette).toEqual(
      expect.arrayContaining([{ command: "muse.open", when: "false" }]),
    );
    expect(extension).toContain(
      'registerCommand("muse.open", () => openPreferred())',
    );
  });

  test("contributes Open in Editor Panel to the sidebar toolbar", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const commands = pkg.contributes.commands as Array<{
      command: string;
      icon?: string;
    }>;
    const toolbar = pkg.contributes.menus["view/title"] as Array<{
      command: string;
      group?: string;
      when?: string;
    }>;
    const extension = readFileSync(resolve("src/extension.ts"), "utf8");

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "muse.openPanel",
          icon: "$(open-preview)",
        }),
      ]),
    );
    expect(toolbar).toEqual(
      expect.arrayContaining([
        {
          command: "muse.openPanel",
          when: "view =~ /muse\\.chatView/",
          group: "navigation",
        },
      ]),
    );
    expect(extension).toContain('registerCommand("muse.openPanel"');
  });

  test("hides the duplicate Open Editor Tab palette entry", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const palette = pkg.contributes.menus.commandPalette as Array<{
      command: string;
      when?: string;
    }>;

    // muse.openEditor duplicates muse.openPanel; its only surface is the
    // editor/title icon, so it stays out of the palette.
    expect(palette).toEqual(
      expect.arrayContaining([{ command: "muse.openEditor", when: "false" }]),
    );
  });

  test("contributes Muse CLI Chat: Open to the Explorer context menu", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const explorer = pkg.contributes.menus["explorer/context"] as Array<{
      command: string;
      group?: string;
      when?: string;
    }>;

    // No `when`, so it shows for files and folders alike.
    expect(explorer).toEqual(
      expect.arrayContaining([{ command: "muse.open", group: "muse@1" }]),
    );
  });
});
