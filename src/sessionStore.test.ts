import { expect, test } from "bun:test";
import { SessionStore } from "./sessionStore";

test("confirmed names and branch ancestry survive reload, share across chats, and isolate roots", async () => {
  const data = new Map<string, unknown>();
  const context = { workspaceState: { get: (key: string) => data.get(key), update: async (key: string, value: unknown) => { data.set(key, value); } } } as any;
  const a = new SessionStore(context, "a");
  const b = new SessionStore(context, "b");
  await a.saveLabel("/project", "parent", "Original");
  await b.saveLabel("/project", "child", "Branch", "parent");
  await b.saveLabel("/project", "child", "Alternative");
  expect(new SessionStore(context, "a").getLabels("/project")).toEqual({
    parent: { name: "Original" }, child: { name: "Alternative", parent: "parent" },
  });
  expect(a.getLabels("/other")).toEqual({});
  expect(a.getSessionId()).not.toBe(b.getSessionId());
});

test("separate chats retain independent ids and transcript caches across reload", () => {
  const data = new Map<string, unknown>();
  const context = { workspaceState: { get: (key: string) => data.get(key), update: async (key: string, value: unknown) => { data.set(key, value); } } } as any;
  const sidebar = new SessionStore(context);
  const a = new SessionStore(context, "chat-a");
  const b = new SessionStore(context, "chat-b");
  const sidebarId = sidebar.getSessionId();
  const idA = a.getSessionId();
  const idB = b.getSessionId();
  expect(idA).not.toBe(idB);
  a.saveTranscript(idA, [{ type: "user", text: "Only chat A" }]);
  b.saveTranscript(idB, [{ type: "user", text: "Only chat B" }]);
  a.newSession();
  expect(sidebar.getSessionId()).toBe(sidebarId);
  expect(new SessionStore(context, "chat-b").getSessionId()).toBe(idB);
  expect(new SessionStore(context, "chat-b").getCachedTranscript()).toEqual([{ type: "user", text: "Only chat B" }]);
  expect(a.getCachedTranscript()).toEqual([]);
});

test("request reuse retains only explicit context, scoped by chat, session and expanded prompt", () => {
  const data = new Map<string, unknown>();
  const context = { workspaceState: { get: (key: string) => data.get(key), update: async (key: string, value: unknown) => { data.set(key, value); } } } as any;
  const a = new SessionStore(context, "a");
  const b = new SessionStore(context, "b");
  a.saveRequestContext("session-one", "expanded request", [{ kind: "file", path: "src/app.ts" }, { kind: "problems" }]);
  expect(new SessionStore(context, "a").getRequestContext("session-one", "expanded request")).toEqual([{ kind: "file", path: "src/app.ts" }, { kind: "problems" }]);
  expect(b.getRequestContext("session-one", "expanded request")).toBeUndefined();
  expect(a.getRequestContext("session-two", "expanded request")).toBeUndefined();
  expect(a.getRequestContext("session-one", "changed request")).toBeUndefined();
  const restored = a.getRequestContext("session-one", "expanded request")!;
  restored.length = 0;
  expect(a.getRequestContext("session-one", "expanded request")).toHaveLength(2);
  for (let i=0;i<64;i++) a.saveRequestContext("session-one", `later ${i}`, []);
  expect(a.getRequestContext("session-one", "expanded request")).toBeUndefined();
  expect(a.getRequestContext("session-one", "later 63")).toEqual([]);
});
