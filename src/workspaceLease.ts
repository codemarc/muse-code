import { resolve, sep } from "node:path";

/** Whole-workspace checkpoints cannot attribute overlapping writers safely. */
export class WorkspaceLease {
  private readonly owners = new Set<string>();
  acquire(path: string): () => void {
    const key = process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    if ([...this.owners].some((owner) => owner === key || owner.startsWith(key + sep) || key.startsWith(owner + sep))) {
      throw new Error("Another Muse chat is using this folder. Wait for that turn to finish or choose a different workspace folder; your draft is preserved.");
    }
    this.owners.add(key);
    let released = false;
    return () => { if (!released) { released = true; this.owners.delete(key); } };
  }
}
export const workspaceLease = new WorkspaceLease();
