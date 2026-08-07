import { describe, expect, test } from "bun:test";
import { buildMuseExecArgs, type MuseSettings } from "./museArgs";

const base: MuseSettings = {
  executablePath: "muse",
  model: "",
  reasoningEffort: "",
  trustWorkspace: true,
  disableApproval: true,
  yolo: false,
  useEchoProvider: false,
  extraArgs: [],
};

describe("buildMuseExecArgs", () => {
  test("default headless posture keeps sandbox (no yolo)", () => {
    const args = buildMuseExecArgs(base, {
      prompt: "hi",
      workspacePath: "/tmp/proj",
      sessionId: "11111111-1111-1111-1111-111111111111",
    });
    expect(args).toContain("--json");
    expect(args).toContain("--trust-workspace");
    expect(args).toContain("--disable-approval");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--disable-sandbox");
    expect(args.at(-1)).toBe("hi");
  });

  test("yolo replaces trust/disable-approval flags", () => {
    const args = buildMuseExecArgs(
      { ...base, yolo: true },
      {
        prompt: "x",
        workspacePath: "/tmp/proj",
        sessionId: "11111111-1111-1111-1111-111111111111",
      },
    );
    expect(args).toContain("--yolo");
    expect(args).not.toContain("--disable-approval");
  });

  test("echo provider", () => {
    const args = buildMuseExecArgs(
      { ...base, useEchoProvider: true },
      {
        prompt: "print hello",
        workspacePath: "/tmp/proj",
        sessionId: "11111111-1111-1111-1111-111111111111",
      },
    );
    expect(args).toContain("--provider");
    expect(args).toContain("echo");
  });
});
