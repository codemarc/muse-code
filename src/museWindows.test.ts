import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import { classifyToolLink } from "./linkTarget";
import { resolveMuseBinary } from "./museArgs";
import { sessionIndexKeys } from "./museSessions";
import { collectDocPaths } from "./previewContent";
import { relativeToWorkspace } from "./workspace";
import {
  isWindowsShimPath,
  museExeInInstallDir,
  resolveWindowsMuseCommand,
  resolveWindowsShimPath,
  type WindowsResolveDeps,
} from "./museWindows";

const LOCAL = "C:\\Users\\dev\\AppData\\Local";
const INSTALL = win32.join(LOCAL, "Programs", "muse");
const VERSION = "1.4.15-R8339.1";
const EXE = win32.join(INSTALL, `muse-bin-${VERSION}.exe`);

function fakeDeps(
  files: Record<string, string>,
  env: NodeJS.ProcessEnv = { LOCALAPPDATA: LOCAL },
): WindowsResolveDeps {
  const norm = (p: string) => p.toLowerCase();
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  return {
    env,
    fileExists: (p) => map.has(norm(p)),
    readText: (p) => map.get(norm(p)) ?? null,
  };
}

const installed = {
  [win32.join(INSTALL, ".muse-version")]: `${VERSION}\r\n`,
  [win32.join(INSTALL, "muse.cmd")]: "@echo off",
  [EXE]: "",
};

describe("museWindows", () => {
  test("detects launcher shims", () => {
    expect(isWindowsShimPath("C:\\x\\muse.cmd")).toBe(true);
    expect(isWindowsShimPath("C:\\x\\.muse-launcher.ps1")).toBe(true);
    expect(isWindowsShimPath("C:\\x\\MUSE.BAT")).toBe(true);
    expect(isWindowsShimPath(EXE)).toBe(false);
  });

  test("reads the versioned exe from .muse-version", () => {
    expect(museExeInInstallDir(INSTALL, fakeDeps(installed))).toBe(EXE);
  });

  test("rejects a malformed .muse-version", () => {
    const deps = fakeDeps({
      [win32.join(INSTALL, ".muse-version")]: "..\\..\\evil",
      [EXE]: "",
    });
    expect(museExeInInstallDir(INSTALL, deps)).toBeNull();
  });

  test("returns null when the versioned exe is missing", () => {
    const deps = fakeDeps({ [win32.join(INSTALL, ".muse-version")]: VERSION });
    expect(museExeInInstallDir(INSTALL, deps)).toBeNull();
  });

  test("bare muse resolves to the default install dir", () => {
    expect(resolveWindowsMuseCommand(fakeDeps(installed))).toEqual({
      ok: true,
      path: EXE,
    });
  });

  test("bare muse falls back to an install dir on PATH", () => {
    const other = "D:\\tools\\muse";
    const otherExe = win32.join(other, `muse-bin-${VERSION}.exe`);
    const deps = fakeDeps(
      {
        [win32.join(other, ".muse-version")]: VERSION,
        [otherExe]: "",
      },
      { LOCALAPPDATA: LOCAL, Path: `C:\\Windows;"${other}"` },
    );
    expect(resolveWindowsMuseCommand(deps)).toEqual({ ok: true, path: otherExe });
  });

  test("bare muse falls back to muse.exe on PATH", () => {
    const deps = fakeDeps(
      { "C:\\bin\\muse.exe": "" },
      { PATH: "C:\\Windows;C:\\bin" },
    );
    expect(resolveWindowsMuseCommand(deps)).toEqual({
      ok: true,
      path: "C:\\bin\\muse.exe",
    });
  });

  test("reports a helpful error when Muse is not installed", () => {
    const r = resolveWindowsMuseCommand(fakeDeps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("muse.executablePath");
    }
  });

  test("maps the muse.cmd shim to the exe beside it", () => {
    expect(
      resolveWindowsShimPath(win32.join(INSTALL, "muse.cmd"), fakeDeps(installed)),
    ).toEqual({ ok: true, path: EXE });
  });

  test("refuses an unknown shim", () => {
    const r = resolveWindowsShimPath("C:\\x\\muse.cmd", fakeDeps({}));
    expect(r.ok).toBe(false);
  });
});

describe("resolveMuseBinary on win32", () => {
  test("bare muse resolves to the exe instead of PATH lookup", () => {
    expect(resolveMuseBinary("muse", "win32", fakeDeps(installed))).toEqual({
      ok: true,
      path: EXE,
    });
  });

  test("bare muse is left to PATH on other platforms", () => {
    expect(resolveMuseBinary("muse", "linux", fakeDeps(installed))).toEqual({
      ok: true,
      path: "muse",
    });
  });
});

describe("Windows paths elsewhere", () => {
  const raw = String.raw;

  test("relativeToWorkspace ignores drive-letter case on win32", () => {
    expect(relativeToWorkspace(raw`c:\proj\src\a.ts`, raw`C:\proj`, "win32")).toBe(
      raw`src\a.ts`,
    );
    expect(relativeToWorkspace(raw`C:\project2\a.ts`, raw`C:\proj`, "win32")).toBeNull();
    expect(relativeToWorkspace(raw`C:\proj`, raw`C:\proj`, "win32")).toBeNull();
  });

  test("relativeToWorkspace stays case-sensitive on POSIX", () => {
    expect(relativeToWorkspace("/proj/src/a.ts", "/proj/", "linux")).toBe("src/a.ts");
    expect(relativeToWorkspace("/Proj/src/a.ts", "/proj", "linux")).toBeNull();
  });

  test("session index keys cover Muse's Windows spellings", () => {
    const keys = sessionIndexKeys(raw`c:\Users\dev\proj`, "win32", (p) => p);
    expect(keys).toContain(raw`C:\Users\dev\proj`);
    expect(keys).toContain("\\\\?\\C:\\Users\\dev\\proj");
  });

  test("session index keys are unchanged on POSIX", () => {
    expect(sessionIndexKeys("/home/dev/proj", "linux", (p) => p)).toEqual([
      "/home/dev/proj",
    ]);
  });

  test("doc path detection accepts backslashes and drive letters", () => {
    const text = raw`Wrote C:\Users\dev\proj\docs\STATUS.md and src\notes.txt, see /tmp/a.md`;
    expect(collectDocPaths(text)).toEqual([
      raw`C:\Users\dev\proj\docs\STATUS.md`,
      raw`src\notes.txt`,
      "/tmp/a.md",
    ]);
  });

  test("file:// URLs with a drive letter map to a Windows path", () => {
    const t = classifyToolLink("file:///C:/proj/report.html");
    expect(t?.kind).toBe("file");
    if (process.platform === "win32" && t?.kind === "file") {
      expect(t.filePath).toBe(raw`C:\proj\report.html`);
    }
  });
});
