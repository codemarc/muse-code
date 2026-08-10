import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Muse local data root (`$XDG_DATA_HOME/muse` or `~/.local/share/muse`). */
export function museDataDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const xdg = env.XDG_DATA_HOME?.trim();
  if (xdg) {
    return join(xdg, "muse");
  }
  return join(home, ".local", "share", "muse");
}

export function museSessionIndexPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(museDataDir(env, home), "session-index.db");
}

export function museSessionIndexExists(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): boolean {
  return existsSync(museSessionIndexPath(env, home));
}
