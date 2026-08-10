import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMuseExecArgs,
  resolveMuseBinary,
  sanitizeExtraArgs,
  type MuseSettings,
} from "./museArgs";

const base: MuseSettings = {
  executablePath: "muse",
  model: "",
  reasoningEffort: "",
  trustWorkspace: true,
  disableApproval: false,
  yolo: false,
  useEchoProvider: false,
  extraArgs: [],
};

describe("buildMuseExecArgs", () => {
  test("default posture keeps sandbox and requires consent for disable-approval", () => {
    const { args, rejectedExtraArgs } = buildMuseExecArgs(base, {
      prompt: "hi",
      workspacePath: "/tmp/proj",
      sessionId: "11111111-1111-1111-1111-111111111111",
    });
    expect(args).toContain("--json");
    expect(args).toContain("--trust-workspace");
    expect(args).not.toContain("--disable-approval");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--disable-sandbox");
    expect(rejectedExtraArgs).toEqual([]);
    expect(args.at(-1)).toBe("hi");
  });

  test("disableApproval adds flag without yolo", () => {
    const { args } = buildMuseExecArgs(
      { ...base, disableApproval: true },
      {
        prompt: "hi",
        workspacePath: "/tmp/proj",
        sessionId: "11111111-1111-1111-1111-111111111111",
      },
    );
    expect(args).toContain("--disable-approval");
    expect(args).not.toContain("--yolo");
  });

  test("yolo replaces trust/disable-approval flags", () => {
    const { args } = buildMuseExecArgs(
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
    const { args } = buildMuseExecArgs(
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

  test("blocks dangerous extraArgs", () => {
    const { args, rejectedExtraArgs } = buildMuseExecArgs(
      {
        ...base,
        extraArgs: ["--yolo", "--max-model-steps", "3", "--disable-sandbox"],
      },
      {
        prompt: "hi",
        workspacePath: "/tmp/proj",
        sessionId: "11111111-1111-1111-1111-111111111111",
      },
    );
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--disable-sandbox");
    expect(args).toContain("--max-model-steps");
    expect(args).toContain("3");
    expect(rejectedExtraArgs).toEqual(["--yolo", "--disable-sandbox"]);
  });
});

describe("sanitizeExtraArgs", () => {
  test("rejects control characters", () => {
    const { allowed, rejected } = sanitizeExtraArgs(["ok", "bad\nflag"]);
    expect(allowed).toEqual(["ok"]);
    expect(rejected).toEqual(["bad\nflag"]);
  });
});

describe("resolveMuseBinary", () => {
  test("allows muse PATH name", () => {
    expect(resolveMuseBinary("muse")).toEqual({ ok: true, path: "muse" });
    expect(resolveMuseBinary("")).toEqual({ ok: true, path: "muse" });
  });

  test("rejects other bare names", () => {
    const r = resolveMuseBinary("evil");
    expect(r.ok).toBe(false);
  });

  test("rejects missing path", () => {
    const r = resolveMuseBinary("/no/such/muse-binary-xyz");
    expect(r.ok).toBe(false);
  });

  test("accepts existing file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-bin-"));
    const bin = join(dir, "muse");
    writeFileSync(bin, "#!/bin/sh\necho muse\n");
    chmodSync(bin, 0o755);
    expect(resolveMuseBinary(bin)).toEqual({ ok: true, path: bin });
  });

  test("rejects control characters", () => {
    const r = resolveMuseBinary("muse\n;rm -rf /");
    expect(r.ok).toBe(false);
  });
});
