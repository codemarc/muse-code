export type MentionSource = "open" | "git" | "search";

export interface MentionCandidate {
  path: string;
  source: MentionSource;
}

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

const TOKEN = /@[A-Za-z0-9_./-]*$/;

export function mentionQueryAt(
  text: string,
  cursor: number,
): MentionQuery | null {
  const before = text.slice(0, Math.max(0, cursor));
  const match = before.match(TOKEN);
  if (!match || match.index == null) {
    return null;
  }
  const start = match.index;
  if (start > 0 && !/\s/.test(before[start - 1] ?? "")) {
    return null;
  }
  return {
    start,
    end: cursor,
    query: match[0].slice(1),
  };
}

export function insertMention(
  text: string,
  range: { start: number; end: number },
  path: string,
): { text: string; cursor: number } {
  const insert = `\`${path}\` `;
  const next = text.slice(0, range.start) + insert + text.slice(range.end);
  return { text: next, cursor: range.start + insert.length };
}

export function mentionSearchGlob(query: string): string | null {
  const safe = query.trim().replace(/[*?[\]{}\\]/g, "");
  if (!safe) {
    return null;
  }
  if (safe.includes("/")) {
    return `**/${safe}*`;
  }
  return `**/*${safe}*`;
}

export function filterMentionCandidates(
  query: string,
  items: MentionCandidate[],
  limit = 12,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const matched: MentionCandidate[] = [];
  const ranked = items.slice().sort((a, b) => {
    const sourceRank = { open: 0, git: 1, search: 2 };
    const bySource = sourceRank[a.source] - sourceRank[b.source];
    if (bySource !== 0) {
      return bySource;
    }
    return a.path.localeCompare(b.path);
  });
  for (const item of ranked) {
    if (seen.has(item.path)) {
      continue;
    }
    if (needle && !item.path.toLowerCase().includes(needle)) {
      continue;
    }
    seen.add(item.path);
    matched.push(item);
    if (matched.length >= limit) {
      break;
    }
  }
  return matched;
}
