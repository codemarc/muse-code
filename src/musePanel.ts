import { MuseClient, MspError, spawnMspConnection, readSessionDurability, type Turn, type FoldedItem, type MspHandshake } from "@muse-code/sdk";
import { PanelApprovals } from "./panelApprovals";
import { PanelQuestions } from "./panelQuestions";
import type { MuseRunOptions } from "./museCli";
import type { MuseSettings } from "./museArgs";

/** An owned MSP host per turn. No shared transport, approval queue or cancellation. */
export function startMusePanel(opts: MuseRunOptions, bin: string, settings: MuseSettings,
  approvals: PanelApprovals, questions?: PanelQuestions): { stop: () => void; settled: Promise<void> } {
  let client: MuseClient | undefined;
  let handshake: MspHandshake | undefined;
  let turn: Turn | undefined;
  let stopped = false;
  let stopping: Promise<unknown> | undefined;
  let stopDeadline: NodeJS.Timeout | undefined;
  let closeQuestions: (() => void) | undefined;
  const stopTurn = () => turn ? stopping ??= turn.interrupt().catch(() => undefined) : Promise.resolve();
  const settled = (async () => {
    let code = 0;
    try {
      const args = ["serve"];
      if (settings.trustWorkspace) args.push("--trust-workspace");
      if (settings.useEchoProvider) args.push("--provider", "echo");
      // The panel always asks for unmatched actions; exec's bypass flags do not apply.
      handshake = spawnMspConnection({ command: bin, args, cwd: opts.workspacePath,
        env: process.env,
        onStderr: opts.onStderr, shutdownTimeoutMs: 2000 });
      const startupDeadline = setTimeout(() => { void handshake?.close().catch(() => undefined); }, 30_000);
      let host;
      try { host = await handshake.initialize({ clientInfo: { name: "muse_cli_chat", version: "0.5.1" } }); }
      finally { clearTimeout(startupDeadline); }
      client = new MuseClient(host.connection, { host, durability: readSessionDurability(host.initializeResult) });
      if (stopped) return;
      const model = settings.model ? { modelId: settings.model } : {};
      let session;
      try {
        session = await client.resumeSession({ sessionId: opts.sessionId, ...model,
          onApproval: approvals.request });
      } catch (error) {
        if (!(error instanceof MspError) || error.kind !== "sessionNotFound") throw error;
        session = await client.startSession({ sessionId: opts.sessionId, workspaceRoot: opts.workspacePath,
          approvalMode: "promptUnmatched", ...model });
        session.onApproval(approvals.request);
      }
      closeQuestions = questions?.bind(session);
      session.onApprovalError((failure) => {
        if (!stopped) opts.onEvent({ kind: "parse_error", line: "", error: `Approval failed: ${failure.kind}. Stop this turn and try again.` });
      });
      await session.setApprovalMode("promptUnmatched");
      if (stopped) return;
      const effort = settings.reasoningEffort;
      const reasoning = effort && /^(none|minimal|low|medium|high|xhigh|max|ultra)$/.test(effort)
        ? { reasoningEffort: effort as "low" | "medium" | "high" } : {};
      turn = await session.sendUserTurn({ input: [{ type: "text", text: opts.prompt }], ...reasoning });
      if (stopped) await stopTurn();
      const seen = new Set<string>();
      const started = new Set<string>();
      const stream = (async () => {
        for await (const item of turn!.items()) {
          if (stopped) continue;
          if (item.kind === "agentMessage" && !started.has(item.itemId)) {
            started.add(item.itemId);
            opts.onEvent({ kind: "assistant_begin" });
          }
          if (item.status === "inProgress" || seen.has(item.itemId)) continue;
          seen.add(item.itemId);
          emitItem(item, opts);
        }
      })();
      const deltas = (async () => {
        for await (const delta of turn!.deltas()) {
          if (!stopped && session.fold.items.get(delta.itemId)?.kind === "agentMessage" && (!delta.field || delta.field === "text")) {
            opts.onEvent({ kind: "assistant_delta", text: delta.delta });
          }
        }
      })();
      const [outcome] = await Promise.all([turn.completed, stream, deltas]);
      if (!stopped && outcome.kind === "completed" && outcome.params.terminal !== "completed") {
        code = 1;
        opts.onEvent({ kind: "status", text: `${outcome.params.terminal}: ${outcome.params.reason ?? JSON.stringify(outcome.params.error ?? "")}` });
      } else if (outcome.kind !== "completed") {
        throw new Error("Muse ended without a confirmed turn result.");
      }
    } catch (error) {
      code = 1;
      if (!stopped) opts.onEvent({ kind: "parse_error", line: "", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (stopDeadline) clearTimeout(stopDeadline);
      approvals.clear();
      closeQuestions?.();
      if (client) await client.close().catch(() => undefined);
      else await handshake?.close().catch(() => undefined);
      opts.onExit?.(code, stopped ? "SIGTERM" : null);
    }
  })();
  return { settled, stop: () => {
    stopped = true; approvals.clear(); closeQuestions?.(); void stopTurn();
    if (!client) void handshake?.close().catch(() => undefined);
    stopDeadline ??= setTimeout(() => { void client?.close().catch(() => undefined); }, 3000);
  } };
}

function emitItem(item: FoldedItem, opts: MuseRunOptions): void {
  if (item.kind === "agentMessage" && item.text) {
    opts.onEvent({ kind: "assistant_final", text: item.text, terminal: "completed" });
  } else if (item.kind === "toolCall") {
    let command: string | undefined;
    let description: string | undefined;
    try {
      const args = JSON.parse(item.args ?? "{}");
      command = typeof args.command === "string" ? args.command : undefined;
      description = typeof args.description === "string" ? args.description : undefined;
    } catch { /* Unknown tool argument formats remain plain output. */ }
    opts.onEvent({ kind: "tool", name: item.tool ?? "tool", resultRaw: String(item.visibleOutput ?? item.failureReason ?? item.text ?? item.args ?? item.status),
      resultView: null, callId: item.callId, status: String(item.status),
      execMeta: { command, description, ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}) } });
  } else if (item.kind === "systemNotice") {
    opts.onEvent({ kind: "status", text: String(item.message ?? item.text ?? item.status) });
  }
}
