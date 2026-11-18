import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("every contributed Muse menu command is declared, including independent new chat", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  const commands = new Set(pkg.contributes.commands.map((item: { command: string }) => item.command));
  expect(commands.has("muse.newChat")).toBe(true);
  for (const items of Object.values(pkg.contributes.menus) as Array<Array<{ command: string }>>) {
    for (const item of items) if (item.command?.startsWith("muse.")) expect(commands.has(item.command)).toBe(true);
  }
});

test("packaged Muse mark preserves the original path and has no active or remote SVG content", () => {
  const original = readFileSync(resolve("media/muse-brand.svg"), "utf8");
  const path = /<path\b[^>]*\bd="([^"]+)"/.exec(original)?.[1];
  expect(path).toBeTruthy();
  for (const name of ["muse-brand.svg", "muse.svg", "muse-toolbar-dark.svg", "muse-toolbar-light.svg"]) {
    const asset = readFileSync(resolve("media", name), "utf8");
    expect(/<path\b[^>]*\bd="([^"]+)"/.exec(asset)?.[1]).toBe(path);
    expect(asset).not.toMatch(/<script|foreignObject|\bon\w+=|(?:href|src)=["']https?:/i);
  }
  expect(original).toContain("#0064E0");
  const png = readFileSync(resolve("media/icon.png"));
  expect(png.readUInt32BE(16)).toBe(256);
  expect(png.readUInt32BE(20)).toBe(256);
});
