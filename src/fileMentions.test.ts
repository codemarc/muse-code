import { describe, expect, test } from "bun:test";
import {
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  mentionSearchGlob,
  type MentionCandidate,
} from "./fileMentions";

describe("mentionQueryAt", () => {
  test("finds an @ query at the cursor", () => {
    const text = "look at @ch";
    expect(mentionQueryAt(text, text.length)).toEqual({
      start: 8,
      end: 11,
      query: "ch",
    });
  });

  test("returns null when there is no @ token", () => {
    expect(mentionQueryAt("hello there", 5)).toBeNull();
  });

  test("ignores emails and mid-word at-signs", () => {
    expect(mentionQueryAt("write marc@blt.dev", 18)).toBeNull();
    expect(mentionQueryAt("foo@bar", 7)).toBeNull();
  });

  test("allows @ at the start of the prompt", () => {
    expect(mentionQueryAt("@src/", 5)).toEqual({
      start: 0,
      end: 5,
      query: "src/",
    });
  });
});

describe("insertMention", () => {
  test("replaces the @ token with a backticked path", () => {
    const text = "look at @ch";
    const next = insertMention(text, { start: 8, end: 11 }, "src/chat.js");
    expect(next.text).toBe("look at `src/chat.js` ");
    expect(next.cursor).toBe(next.text.length);
  });
});

describe("filterMentionCandidates", () => {
  const items: MentionCandidate[] = [
    { path: "src/chat.js", source: "open" },
    { path: "src/extension.ts", source: "git" },
    { path: "README.md", source: "search" },
    { path: "media/chat.js", source: "search" },
  ];

  test("ranks open files first when the query is empty", () => {
    const ranked = filterMentionCandidates("", items, 8);
    expect(ranked[0]?.path).toBe("src/chat.js");
    expect(ranked[0]?.source).toBe("open");
  });

  test("filters by path substring", () => {
    const ranked = filterMentionCandidates("chat", items, 8);
    expect(ranked.map((item) => item.path)).toEqual([
      "src/chat.js",
      "media/chat.js",
    ]);
  });
});

describe("mentionSearchGlob", () => {
  test("returns null for an empty query", () => {
    expect(mentionSearchGlob("")).toBeNull();
    expect(mentionSearchGlob("   ")).toBeNull();
  });

  test("builds a substring glob and strips glob metacharacters", () => {
    expect(mentionSearchGlob("chat")).toBe("**/*chat*");
    expect(mentionSearchGlob("src/ch")).toBe("**/src/ch*");
    expect(mentionSearchGlob("foo*bar")).toBe("**/*foobar*");
  });
});
