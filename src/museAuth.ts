import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** macOS Keychain item Muse Code 1.0.x uses for Meta OAuth. */
export const MUSE_MACOS_KEYCHAIN_SERVICE = "ai.meta.dev.credentials";
export const MUSE_MACOS_KEYCHAIN_ACCOUNT = "meta";

export type AuthProbeResult =
  | { ok: true; source: "echo" | "env" | "stored" | "keychain"; detail: string }
  | { ok: false; message: string; hint: string };

type MetaProvider = {
  access_token?: unknown;
  api_key?: unknown;
  user_email?: unknown;
  storage?: unknown;
};

export function defaultMuseAuthPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg || join(homedir(), ".config");
  return join(base, "muse", "auth.json");
}

/**
 * Best-effort presence check for Muse's macOS Keychain secret.
 * Does not read the password.
 */
export function defaultKeychainHasMetaCredential(
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "darwin") {
    return true;
  }
  const result = spawnSync(
    "security",
    [
      "find-generic-password",
      "-s",
      MUSE_MACOS_KEYCHAIN_SERVICE,
      "-a",
      MUSE_MACOS_KEYCHAIN_ACCOUNT,
    ],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

function hasInlineCredential(meta: MetaProvider | undefined): boolean {
  const hasToken =
    typeof meta?.access_token === "string" && meta.access_token.trim().length > 0;
  const hasKey =
    typeof meta?.api_key === "string" && meta.api_key.trim().length > 0;
  return hasToken || hasKey;
}

function isKeychainBacked(meta: MetaProvider | undefined): boolean {
  return (
    typeof meta?.storage === "string" && meta.storage.trim().toLowerCase() === "keychain"
  );
}

function storedDetail(meta: MetaProvider | undefined, viaKeychain: boolean): string {
  const email =
    typeof meta?.user_email === "string" && meta.user_email.includes("@")
      ? meta.user_email
      : undefined;
  const where = viaKeychain ? "keychain" : "auth.json";
  return email
    ? `stored Meta credentials (${email}, ${where})`
    : `stored Meta credentials found (${where})`;
}

/**
 * Best-effort check that Muse can call the Meta API.
 * Does not validate the credential with the network; only detects presence.
 */
export function probeMuseAuth(opts: {
  useEchoProvider: boolean;
  env?: NodeJS.ProcessEnv;
  authPath?: string;
  readAuthFile?: (path: string) => string | null;
  keychainHasMetaCredential?: () => boolean;
}): AuthProbeResult {
  if (opts.useEchoProvider) {
    return {
      ok: true,
      source: "echo",
      detail: "echo provider (offline; no Meta auth required)",
    };
  }

  const env = opts.env ?? process.env;
  const key = env.META_API_KEY?.trim();
  if (key) {
    return {
      ok: true,
      source: "env",
      detail: "META_API_KEY is set in the editor environment",
    };
  }

  const authPath = opts.authPath ?? defaultMuseAuthPath(env);
  const read =
    opts.readAuthFile ??
    ((path: string) => {
      try {
        if (!existsSync(path)) {
          return null;
        }
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    });

  const raw = read(authPath);
  if (!raw) {
    return {
      ok: false,
      message:
        "Muse CLI is installed but no Meta credentials were found for this editor process.",
      hint: [
        "Sign in from a terminal: muse login",
        "Or store a key: muse auth set --api-key-stdin",
        "Or set META_API_KEY in the environment that launches Cursor/VS Code (not only your shell).",
      ].join("\n"),
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      providers?: { meta?: MetaProvider };
    };
    const meta = parsed.providers?.meta;
    if (hasInlineCredential(meta)) {
      return {
        ok: true,
        source: "stored",
        detail: storedDetail(meta, false),
      };
    }
    if (isKeychainBacked(meta)) {
      const hasSecret =
        opts.keychainHasMetaCredential?.() ?? defaultKeychainHasMetaCredential();
      if (hasSecret) {
        return {
          ok: true,
          source: "keychain",
          detail: storedDetail(meta, true),
        };
      }
      return {
        ok: false,
        message:
          "Muse auth.json points at the macOS Keychain, but no Meta credential was found there.",
        hint: "Run: muse login\nor: muse auth set --api-key-stdin",
      };
    }
    return {
      ok: false,
      message: "Muse auth.json exists but has no usable Meta credential.",
      hint: "Run: muse login\nor: muse auth set --api-key-stdin",
    };
  } catch {
    return {
      ok: false,
      message: `Could not parse Muse auth file at ${authPath}.`,
      hint: "Run: muse logout && muse login",
    };
  }
}
