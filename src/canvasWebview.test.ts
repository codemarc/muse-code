import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

class FakeClassList {
  private readonly names = new Set<string>();

  toggle(name: string, active: boolean): void {
    if (active) this.names.add(name);
    else this.names.delete(name);
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeElement {
  hidden = false;
  textContent = "";
  className = "";
  href = "";
  srcdoc = "";
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, (event: unknown) => void>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }

  appendChild(): void {}

  removeAttribute(name: string): void {
    if (name === "srcdoc") this.srcdoc = "";
  }
}

function loadCanvas() {
  const ids = [
    "label",
    "exit",
    "body",
    "preview-frame",
    "readable",
    "raw",
    "source",
    "preview",
    "open-ext",
    "copy",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  let onMessage: ((event: { data: unknown }) => void) | undefined;

  const document = {
    getElementById: (id: string) => elements.get(id),
    createTextNode: () => new FakeElement(),
    createElement: () => new FakeElement(),
  };
  const window = {
    addEventListener: (
      type: string,
      listener: (event: { data: unknown }) => void,
    ) => {
      if (type === "message") onMessage = listener;
    },
  };
  const script = readFileSync(resolve("media/canvas.js"), "utf8");
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document,
    navigator: {},
    window,
  });

  return {
    element: (id: string) => elements.get(id)!,
    send(data: unknown) {
      if (!onMessage) {
        throw new Error("canvas message listener was not installed");
      }
      onMessage({ data });
    },
  };
}

describe("canvas default mode", () => {
  test("opens a renderable file in Source", () => {
    const canvas = loadCanvas();
    canvas.send({
      type: "canvasData",
      source: "file",
      name: "PRIVACY.md",
      resultRaw: "# Privacy",
      previewHtml: "<h1>Privacy</h1>",
      previewBody: "# Privacy",
      previewKind: "markdown",
      filePath: "/workspace/PRIVACY.md",
    });

    expect(canvas.element("source").classList.contains("active")).toBe(true);
    expect(canvas.element("preview").classList.contains("active")).toBe(false);
    expect(canvas.element("body").hidden).toBe(false);
    expect(canvas.element("preview-frame").hidden).toBe(true);
  });

  test("keeps Preview as the default for previewable raw tool output", () => {
    const canvas = loadCanvas();
    canvas.send({
      type: "canvasData",
      source: "stdout",
      resultRaw: "# Report",
      resultView: null,
      previewHtml: "<h1>Report</h1>",
      previewBody: "# Report",
      previewKind: "markdown",
    });

    expect(canvas.element("preview").classList.contains("active")).toBe(true);
    expect(canvas.element("preview-frame").hidden).toBe(false);
  });
});
