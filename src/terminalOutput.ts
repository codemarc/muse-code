/**
 * Capture recent integrated-terminal output via shell integration.
 *
 * VS Code exposes no API to read the existing terminal buffer, so this store
 * taps `onDidStartTerminalShellExecution` and streams each command's output
 * through `execution.read()`. Entries accumulate after activation; the
 * Terminal chip attaches the most recent ones.
 */

import * as vscode from "vscode";
import { MAX_TERMINAL_ENTRIES, type TerminalEntry } from "./contextAttachments";

const MAX_STORED_CHARS = 16_000;

interface PendingExecution {
  command: string;
  chunks: string[];
  chars: number;
  streamDone: boolean;
  endSeen: boolean;
  exitCode?: number;
}

export class TerminalOutputStore implements vscode.Disposable {
  private readonly entries: TerminalEntry[] = [];
  private readonly pending = new Map<object, PendingExecution>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Subscribe to shell executions. Safe to call once from extension setup. */
  start(): void {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((e) => {
        void this.tapExecution(e.execution);
      }),
      vscode.window.onDidEndTerminalShellExecution((e) => {
        this.finishExecution(e.execution, e.exitCode);
      }),
    );
  }

  /** Most recent entries first-capped to `limit`. Returns copies. */
  recent(limit = MAX_TERMINAL_ENTRIES): TerminalEntry[] {
    return this.entries.slice(-limit).map((e) => ({ ...e }));
  }

  get size(): number {
    return this.entries.length;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.pending.clear();
  }

  private async tapExecution(execution: vscode.TerminalShellExecution): Promise<void> {
    const command = execution.commandLine?.value ?? "";
    let state = this.pending.get(execution);
    if (!state) {
      state = {
        command,
        chunks: [],
        chars: 0,
        streamDone: false,
        endSeen: false,
      };
      this.pending.set(execution, state);
    }
    try {
      for await (const chunk of execution.read()) {
        state.chunks.push(chunk);
        state.chars += chunk.length;
        // Keep the tail: drop head chunks past the cap.
        while (state.chars > MAX_STORED_CHARS && state.chunks.length > 1) {
          const head = state.chunks.shift();
          state.chars -= head?.length ?? 0;
        }
      }
    } catch {
      // Reading is best-effort (task terminals, disposed executions).
    }
    state.streamDone = true;
    this.maybePush(execution, state);
  }

  private finishExecution(
    execution: vscode.TerminalShellExecution,
    exitCode: number | undefined,
  ): void {
    const state = this.pending.get(execution);
    if (!state) {
      // Start event was missed (e.g. command predates activation): no output
      // tap exists, so record the command without output.
      this.entries.push({
        command: execution.commandLine?.value ?? "",
        output: "",
        exitCode,
      });
      while (this.entries.length > MAX_TERMINAL_ENTRIES) {
        this.entries.shift();
      }
      return;
    }
    state.endSeen = true;
    state.exitCode = exitCode;
    this.maybePush(execution, state);
  }

  private maybePush(execution: object, state: PendingExecution): void {
    // Push once both the output stream and the end event have landed, or
    // when the end event fired but the stream never produces (no read tap).
    if (!state.endSeen || !state.streamDone) {
      return;
    }
    this.pending.delete(execution);
    this.entries.push({
      command: state.command,
      output: state.chunks.join(""),
      exitCode: state.exitCode,
    });
    while (this.entries.length > MAX_TERMINAL_ENTRIES) {
      this.entries.shift();
    }
  }
}
