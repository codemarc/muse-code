import { describe, expect, test } from "bun:test";
import {
  buildModeBannerText,
  buildMuseStatusText,
  buildMuseStatusTooltip,
  formatEffortPill,
  formatModelPill,
  shortSessionId,
} from "./museUi";

describe("shortSessionId", () => {
  test("uses the first 8 chars with an em-dash fallback", () => {
    expect(shortSessionId("abcdef12-34")).toBe("abcdef12");
    expect(shortSessionId("")).toBe("————");
  });
});

describe("pill labels", () => {
  test("empty model falls back to auto", () => {
    expect(formatModelPill("")).toBe("auto");
    expect(formatModelPill("  ")).toBe("auto");
    expect(formatModelPill("muse-3")).toBe("muse-3");
  });

  test("empty effort falls back to default and values capitalize", () => {
    expect(formatEffortPill("")).toBe("default");
    expect(formatEffortPill("medium")).toBe("Medium");
    expect(formatEffortPill("xhigh")).toBe("Xhigh");
  });
});

describe("buildMuseStatusText", () => {
  test("idle shows the sparkle label with session and mode", () => {
    expect(
      buildMuseStatusText({
        running: false,
        modeLabel: "Headless",
        sessionId: "abcdef12-xyz",
      }),
    ).toBe("✨ Muse abcdef12 · Headless");
  });

  test("running shows a spinner codicon instead", () => {
    expect(
      buildMuseStatusText({
        running: true,
        modeLabel: "Interactive",
        sessionId: "12345678-xyz",
      }),
    ).toBe("$(sync~spin) Muse 12345678 · Interactive");
  });
});

describe("buildMuseStatusTooltip", () => {
  test("names mode, session, and folder", () => {
    const tip = buildMuseStatusTooltip({
      modeLabel: "Headless",
      modeDescription: "Native chat path.",
      sessionId: "abcdef12-xyz",
      folderName: "pos",
    });
    expect(tip).toContain("Headless");
    expect(tip).toContain("abcdef12");
    expect(tip).toContain("pos");
    expect(tip).toContain("Native chat path.");
  });
});

describe("buildModeBannerText", () => {
  test("combines the mode label and description", () => {
    expect(buildModeBannerText("Headless", "Approvals off.")).toBe(
      "Headless mode active — Approvals off.",
    );
    expect(buildModeBannerText("", "")).toBe("Headless mode active.");
  });
});
