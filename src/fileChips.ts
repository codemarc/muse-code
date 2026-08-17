/**
 * Build the file chips shown under chat messages.
 *
 * Chips are verified on the extension host: a path only becomes a chip when it
 * exists on disk, so placeholder paths in prose (`<root>/…/session.jsonl`) and
 * partial matches never produce a chip that fails when clicked.
 */

import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { resolveToolLinkPath } from "./linkTarget";
import {
  chipLabelForKind,
  collectDocPaths,
  kindFromPath,
  type PreviewKind,
} from "./previewContent";

export const MAX_FILE_CHIPS = 6;

export interface FileChip {
  /** Absolute path on disk. */
  href: string;
  name: string;
  label: string;
  kind: PreviewKind;
}

export function buildFileChips(
  text: string,
  workspaceRoot?: string,
  limit = MAX_FILE_CHIPS,
): FileChip[] {
  if (!text) {
    return [];
  }

  const chips: FileChip[] = [];
  const seen = new Set<string>();

  for (const candidate of collectDocPaths(text)) {
    if (/^https?:\/\//i.test(candidate)) {
      continue;
    }
    const resolved = resolveToolLinkPath(candidate, workspaceRoot);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (!isReadableFile(resolved)) {
      continue;
    }
    const kind = kindFromPath(resolved);
    chips.push({
      href: resolved,
      name: basename(resolved),
      label: chipLabelForKind(kind, resolved),
      kind,
    });
    if (chips.length >= limit) {
      break;
    }
  }

  return chips;
}

function isReadableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
