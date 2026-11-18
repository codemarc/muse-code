import { spawnMspConnection } from "@muse-code/sdk";

export function branchResult(sourceId: string, response: Record<string, unknown>): { sessionId: string; name?: string } {
  const session = response.session as { sessionId?: unknown; name?: unknown } | undefined;
  if (typeof session?.sessionId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session.sessionId) || session.sessionId === sourceId) {
    throw new Error("Muse did not return an independent branch session.");
  }
  return { sessionId: session.sessionId, ...(typeof session.name === "string" ? { name: session.name } : {}) };
}

export function validateSessionName(value: string): string | undefined {
  if (!value.trim()) return "Enter a conversation name.";
  if (value.trim().length > 120) return "Use at most 120 characters.";
  if (/[\x00-\x1f\x7f]/.test(value)) return "Use a single line without control characters.";
  return undefined;
}

/** Native durable operations only: never copy logs or replay prompts/tools. */
export async function runSessionAction(options: {
  binary: string; workspacePath: string; sessionId: string; trustWorkspace: boolean;
  echo: boolean;
}): Promise<{ sessionId: string; name?: string }> {
  const args = ["serve"];
  if (options.trustWorkspace) args.push("--trust-workspace");
  if (options.echo) args.push("--provider", "echo");
  const host = spawnMspConnection({ command: options.binary, args, cwd: options.workspacePath,
    env: process.env, shutdownTimeoutMs: 2000 });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const initialized = await host.initialize({ clientInfo: { name: "muse_cli_chat", version: "0.5.1" } });
        // Omitted cutPoint means all completed turns; Muse validates the boundary.
        // Fork directly: resume is unnecessary and some Windows hosts rewrite source metadata on resume.
        // A timeout is ambiguous, so never automatically replay this non-idempotent user action.
        const result = await initialized.connection.command("session/fork", {
          sessionId: options.sessionId, excludeItems: true,
        }, { maxAttempts: 1 });
        return branchResult(options.sessionId, result);
      })(),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error(
        "Muse session operation timed out; its outcome may be unknown. Check session history before retrying.")), 45_000); }),
    ]);
  } finally {
    clearTimeout(deadline);
    await host.close().catch(() => undefined);
  }
}
