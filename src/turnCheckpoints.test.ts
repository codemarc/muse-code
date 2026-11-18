import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { TurnCheckpointStore, checkpointText } from "./turnCheckpoints";

async function fixture(run: (root: string, storage: string, git: (...args: string[]) => string) => Promise<void>) {
  const temp = await mkdtemp(join(tmpdir(), "muse-checkpoints-"));
  const root = join(temp, "repo");
  const storage = join(temp, "storage");
  await mkdir(root);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
  };
  try {
    git("init");
    await writeFile(join(root, "app.ts"), "baseline\n");
    git("add", "app.ts");
    git("-c", "user.name=Muse Test", "-c", "user.email=muse@example.invalid", "commit", "-m", "baseline");
    await run(root, storage, git);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

test("persistent turn diff/undo preserves staged and unstaged pre-turn edits and the Git index", async () => fixture(async (root, storage, git) => {
  await writeFile(join(root, "app.ts"), "user staged\r\n");
  git("add", "app.ts");
  await writeFile(join(root, "app.ts"), "user staged\r\nuser unstaged\r\n");
  const indexBefore = git("diff", "--cached");
  const before = await readFile(join(root, "app.ts"));
  const store = new TurnCheckpointStore(storage);
  const pending = await store.begin(root, "session", "change app");
  await writeFile(join(root, "app.ts"), Buffer.concat([before, Buffer.from("Muse edit\r\n")]));
  const turn = await store.finish(pending);
  expect(turn.files.length).toBe(1);
  expect(checkpointText(turn.files[0].before)).toBe(before.toString());
  expect(checkpointText(turn.files[0].after)).toContain("Muse edit");
  const reopened = new TurnCheckpointStore(storage);
  expect((await reopened.list(root, "session"))[0].id).toBe(turn.id);
  expect(await reopened.list(root, "other session")).toEqual([]);
  await reopened.undo(root, turn.id);
  expect(await readFile(join(root, "app.ts"))).toEqual(before);
  expect(git("diff", "--cached")).toBe(indexBefore);
  expect((await reopened.list(root, "session"))[0].state).toBe("undone");
  await reopened.undo(root, turn.id); // idempotent
  expect(await readFile(join(root, "app.ts"))).toEqual(before);
  const after = Buffer.from(turn.files[0].after!.data, "base64");
  await reopened.redo(root, turn.id);
  expect(await readFile(join(root, "app.ts"))).toEqual(after);
  expect(git("diff", "--cached")).toBe(indexBefore);
  expect((await new TurnCheckpointStore(storage).list(root, "session"))[0].state).toBe("complete");
  await reopened.redo(root, turn.id); // idempotent
  await reopened.undo(root, turn.id);
  expect(await readFile(join(root, "app.ts"))).toEqual(before);
  expect((await reopened.finish(pending)).state).toBe("undone");
}));

test("redo refuses all files when an undone turn has newer edits or an unsaved editor", async () => fixture(async (root, storage) => {
  const store = new TurnCheckpointStore(storage);
  const pending = await store.begin(root, "s", "create and edit");
  await writeFile(join(root, "app.ts"), "Muse edit\n");
  await writeFile(join(root, "new.ts"), "Muse new file\n");
  const turn = await store.finish(pending);
  await store.undo(root, turn.id);
  await expect(store.redo(root, turn.id, [join(root, "app.ts")])).rejects.toThrow("unsaved editor");
  await writeFile(join(root, "new.ts"), "user file created after undo\n");
  await expect(store.redo(root, turn.id)).rejects.toThrow("changed after undo");
  expect(await readFile(join(root, "app.ts"), "utf8")).toBe("baseline\n");
  expect(await readFile(join(root, "new.ts"), "utf8")).toBe("user file created after undo\n");
  expect((await store.load(root, turn.id)).state).toBe("undone");
  await unlink(join(root, "new.ts"));
  await store.redo(root, turn.id);
  expect(await readFile(join(root, "app.ts"), "utf8")).toBe("Muse edit\n");
  expect(await readFile(join(root, "new.ts"), "utf8")).toBe("Muse new file\n");
}));

test("a later edit blocks the whole turn before any file is touched", async () => fixture(async (root, storage) => {
  const store = new TurnCheckpointStore(storage);
  const pending = await store.begin(root, "s", "multiple edits");
  await writeFile(join(root, "app.ts"), "Muse change\n");
  await writeFile(join(root, "new.ts"), "created by Muse\n");
  const turn = await store.finish(pending);
  await writeFile(join(root, "new.ts"), "later user edit\n");
  await expect(store.undo(root, turn.id)).rejects.toThrow("changed after this turn");
  expect(await readFile(join(root, "app.ts"), "utf8")).toBe("Muse change\n");
  expect(await readFile(join(root, "new.ts"), "utf8")).toBe("later user edit\n");
  expect((await store.load(root, turn.id)).state).toBe("complete");
}));

test("unsaved buffers block undo; unrelated later edits remain untouched", async () => fixture(async (root, storage) => {
  const store = new TurnCheckpointStore(storage);
  const pending = await store.begin(root, "s", "edit");
  await writeFile(join(root, "app.ts"), "Muse\n");
  const turn = await store.finish(pending);
  await expect(store.undo(root, turn.id, [join(root, "app.ts")])).rejects.toThrow("unsaved editor");
  await writeFile(join(root, "personal.txt"), "later work\n");
  await store.undo(root, turn.id);
  expect(await readFile(join(root, "app.ts"), "utf8")).toBe("baseline\n");
  expect(await readFile(join(root, "personal.txt"), "utf8")).toBe("later work\n");
}));

test("undo restores deleted/untracked binary files byte-for-byte and removes only unchanged turn creations", async () => fixture(async (root, storage) => {
  const binary = Buffer.from([0, 255, 12, 13, 10]);
  await writeFile(join(root, "prior.bin"), binary);
  const store = new TurnCheckpointStore(storage);
  const pending = await store.begin(root, "s", "delete and create");
  await unlink(join(root, "prior.bin"));
  await unlink(join(root, "app.ts"));
  await writeFile(join(root, "renamed.ts"), "baseline\n");
  const turn = await store.finish(pending);
  expect(turn.files.length).toBe(3);
  await store.undo(root, turn.id);
  expect(await readFile(join(root, "prior.bin"))).toEqual(binary);
  expect(await readFile(join(root, "app.ts"), "utf8")).toBe("baseline\n");
  await expect(readFile(join(root, "renamed.ts"))).rejects.toThrow();
  await store.redo(root, turn.id);
  await expect(readFile(join(root, "prior.bin"))).rejects.toThrow();
  await expect(readFile(join(root, "app.ts"))).rejects.toThrow();
  expect(await readFile(join(root, "renamed.ts"), "utf8")).toBe("baseline\n");
}));

test("multiple turns remain distinct; undoing an older conflicting turn never overwrites the newer one", async () => fixture(async (root, storage) => {
  const store = new TurnCheckpointStore(storage);
  const first = await store.begin(root, "s", "first");
  await writeFile(join(root, "app.ts"), "first\n");
  const a = await store.finish(first);
  const second = await store.begin(root, "s", "second");
  await writeFile(join(root, "app.ts"), "second\n");
  const b = await store.finish(second);
  expect((await store.list(root, "s")).length).toBe(2);
  await expect(store.undo(root, a.id)).rejects.toThrow("changed after this turn");
  await store.undo(root, b.id);
  await store.undo(root, a.id);
  expect(await readFile(join(root, "app.ts"), "utf8")).toBe("baseline\n");
}));

test("safe limits fail before execution and link substitutions never affect their targets", async () => fixture(async (root, storage) => {
  const store = new TurnCheckpointStore(storage);
  await writeFile(join(root, "large.bin"), Buffer.alloc(4 * 1024 * 1024 + 1));
  await expect(store.begin(root, "s", "large")).rejects.toThrow("exceeds 4 MB");
  await unlink(join(root, "large.bin"));
  const pending = await store.begin(root, "s", "link");
  await writeFile(join(root, "app.ts"), "Muse\n");
  const turn = await store.finish(pending);
  const outside = join(storage, "outside.txt");
  await writeFile(outside, "outside data");
  await unlink(join(root, "app.ts"));
  await symlink(outside, join(root, "app.ts"));
  await expect(store.undo(root, turn.id)).rejects.toThrow("link");
  expect(await readFile(outside, "utf8")).toBe("outside data");
}));

test("changing gitignore does not misclassify existing files as deleted", async () => fixture(async (root, storage) => {
  await writeFile(join(root, "personal.txt"), "keep me");
  const store = new TurnCheckpointStore(storage);
  const pending = await store.begin(root, "s", "ignore file");
  await writeFile(join(root, ".gitignore"), "personal.txt\n");
  const turn = await store.finish(pending);
  expect(turn.files.map((file) => file.path)).toEqual([".gitignore"]);
  await store.undo(root, turn.id);
  expect(await readFile(join(root, "personal.txt"), "utf8")).toBe("keep me");
}));
