/**
 * Where the chat view lives.
 *
 * VS Code 1.106+ can host extension view containers in the secondary (right)
 * side bar, which keeps Explorer/SCM visible next to the chat. package.json
 * declares two containers and gates each view on a context key, the same
 * pattern Codex and Claude Code use:
 *   - `muse-secondary` / `muse.chatViewSecondary` when supported
 *   - `muse-activity`  / `muse.chatView` otherwise (older VS Code, Cursor)
 */

export const PRIMARY_VIEW_ID = "muse.chatView";
export const SECONDARY_VIEW_ID = "muse.chatViewSecondary";
export const NO_SECONDARY_CONTEXT_KEY = "muse.doesNotSupportSecondarySidebar";

const MIN_MAJOR = 1;
const MIN_MINOR = 106;

export function supportsSecondarySidebar(version: string, appName: string): boolean {
  if (/cursor/i.test(appName)) {
    return false;
  }
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
}

export function activeChatViewId(version: string, appName: string): string {
  return supportsSecondarySidebar(version, appName) ? SECONDARY_VIEW_ID : PRIMARY_VIEW_ID;
}
