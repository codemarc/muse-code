export interface FolderRef {
  name: string;
  fsPath: string;
  uriString: string;
}

/** Pure helper: resolve a stored URI against current folders. */
export function matchStoredFolder(
  folders: readonly FolderRef[],
  storedUri: string | undefined,
): FolderRef | undefined {
  if (folders.length === 0) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  if (!storedUri) {
    return undefined;
  }
  return folders.find((f) => f.uriString === storedUri);
}
