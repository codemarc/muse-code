import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuthProbeResult =
  | { ok: true; source: "echo" | "env" | "stored"; detail: string }
  | { ok: false; message: string; hint: string };

export function defaultMuseAuthPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg || join(homedir(), ".config");
  return join(base, "muse", "auth.json");
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
      providers?: {
        meta?: {
          access_token?: unknown;
          api_key?: unknown;
          user_email?: unknown;
        };
      };
    };
    const meta = parsed.providers?.meta;
    const hasToken =
      typeof meta?.access_token === "string" && meta.access_token.trim().length > 0;
    const hasKey =
      typeof meta?.api_key === "string" && meta.api_key.trim().length > 0;
    if (!hasToken && !hasKey) {
      return {
        ok: false,
        message: "Muse auth.json exists but has no usable Meta credential.",
        hint: "Run: muse login\nor: muse auth set --api-key-stdin",
      };
    }
    const email =
      typeof meta?.user_email === "string" && meta.user_email.includes("@")
        ? meta.user_email
        : undefined;
    return {
      ok: true,
      source: "stored",
      detail: email
        ? `stored Meta credentials (${email})`
        : "stored Meta credentials found",
    };
  } catch {
    return {
      ok: false,
      message: `Could not parse Muse auth file at ${authPath}.`,
      hint: "Run: muse logout && muse login",
    };
  }
}
