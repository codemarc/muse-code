import { describe, expect, test } from "bun:test";
import {
  buildPreviewFromPayload,
  buildPreviewHtml,
  findPrimaryDocPath,
  markdownToHtml,
  previewBodyFromPayload,
  sanitizeHtmlFragment,
  sniffPreviewKind,
} from "./previewContent";

describe("sniffPreviewKind", () => {
  test("returns none for shell listing", () => {
    expect(sniffPreviewKind("total 72\n-rw-r--r-- icon.png\n")).toBe("none");
  });

  test("returns none for lone shell comment", () => {
    expect(sniffPreviewKind("# compile assets\necho hi")).toBe("none");
  });

  test("detects markdown via heading + list", () => {
    const md = "# Report\n\n- one\n- two\n";
    expect(sniffPreviewKind(md)).toBe("markdown");
  });

  test("detects markdown via fenced code", () => {
    expect(sniffPreviewKind("Intro\n\n```js\nconst x = 1;\n```\n")).toBe(
      "markdown",
    );
  });

  test("detects html doctype", () => {
    expect(
      sniffPreviewKind("<!DOCTYPE html><html><body><h1>Hi</h1></body></html>"),
    ).toBe("html");
  });

  test("path hint forces html", () => {
    expect(sniffPreviewKind("hello", { pathHint: "/tmp/report.html" })).toBe(
      "html",
    );
  });

  test("path hint forces markdown", () => {
    expect(sniffPreviewKind("hello", { pathHint: "/tmp/notes.md" })).toBe(
      "markdown",
    );
  });

  test("prefers html when both could match", () => {
    expect(sniffPreviewKind("<h1>Title</h1>\n<p>Body</p>")).toBe("html");
  });
});

describe("previewBodyFromPayload", () => {
  test("uses exec envelope output only", () => {
    const raw = JSON.stringify({
      command: "cat report.md",
      description: "show report",
      exit_code: 0,
      output: "# Hello\n\n- a\n- b\n",
      truncated: false,
    });
    expect(previewBodyFromPayload({ resultRaw: raw })).toBe(
      "# Hello\n\n- a\n- b\n",
    );
  });

  test("falls back to resultView then raw", () => {
    expect(
      previewBodyFromPayload({
        resultRaw: "raw",
        resultView: "view",
      }),
    ).toBe("view");
    expect(previewBodyFromPayload({ resultRaw: "raw" })).toBe("raw");
  });
});

describe("sanitizeHtmlFragment", () => {
  test("strips script tags", () => {
    const out = sanitizeHtmlFragment(
      '<p>ok</p><script>alert(1)</script><p>end</p>',
    );
    expect(out).toContain("<p>ok</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  test("strips onerror handlers", () => {
    const out = sanitizeHtmlFragment('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  test("neutralizes javascript href", () => {
    const out = sanitizeHtmlFragment(
      '<a href="javascript:alert(1)">x</a>',
    );
    expect(out).toContain('href="#"');
    expect(out).not.toContain("javascript:");
  });

  test("strips external images", () => {
    const out = sanitizeHtmlFragment(
      '<p>a</p><img src="https://evil.example/x.png" alt="pic"><p>b</p>',
    );
    expect(out).not.toContain("<img");
    expect(out).toContain("pic");
  });
});

describe("markdownToHtml", () => {
  test("renders heading and list", () => {
    const html = markdownToHtml("# Title\n\n- a\n- b\n");
    expect(html).toContain("<h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
  });

  test("escapes raw html in markdown text", () => {
    const html = markdownToHtml("Hello <script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("renders safe links", () => {
    const html = markdownToHtml("See [docs](https://example.com)");
    expect(html).toContain('href="https://example.com"');
  });

  test("drops javascript links", () => {
    const html = markdownToHtml("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});

describe("buildPreviewHtml / buildPreviewFromPayload", () => {
  test("builds wrapped document for markdown", () => {
    const doc = buildPreviewHtml("# Hi\n\n- a\n- b\n", "markdown");
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("<h1>");
  });

  test("buildPreviewFromPayload returns null html for ls", () => {
    const built = buildPreviewFromPayload({
      resultRaw: JSON.stringify({
        command: "ls",
        output: "total 1\nfile.txt\n",
        exit_code: 0,
      }),
    });
    expect(built.kind).toBe("none");
    expect(built.previewHtml).toBeNull();
  });

  test("buildPreviewFromPayload for md report", () => {
    const built = buildPreviewFromPayload({
      resultRaw: JSON.stringify({
        command: "cat report.md",
        output: "# Report\n\n```\ncode\n```\n",
        exit_code: 0,
      }),
    });
    expect(built.kind).toBe("markdown");
    expect(built.previewHtml).toContain("<h1>");
  });
});

describe("findPrimaryDocPath", () => {
  test("finds absolute html path", () => {
    expect(findPrimaryDocPath("wrote /tmp/out/report.html ok")).toBe(
      "/tmp/out/report.html",
    );
  });

  test("returns null when absent", () => {
    expect(findPrimaryDocPath("no docs here")).toBeNull();
  });
});
