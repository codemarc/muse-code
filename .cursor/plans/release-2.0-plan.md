# Muse CLI Chat 2.0 plan

## Release intent

Make Muse CLI Chat mode-aware without replacing the current execution path in
this release. The native chat remains the default, while interactive execution
is made explicit and visible. The next release can add the MSP host behind the
same boundary.

## 2.0 scope

- Define a small execution-mode contract: `headless` and `interactive`.
- Keep `headless` as the default and preserve `muse exec --json` behavior.
- Make `interactive` route Open Chat to the existing integrated Muse terminal.
- Show the active mode in the chat header and expose its operational meaning.
- Keep the existing `muse.useTerminal` setting compatible; it remains a legacy
  alias for choosing interactive launch behavior.
- Test the setting, normalization, routing, and visible mode metadata.

## Explicitly out of scope

- Do not expose an `msp` setting before the MSP host is integrated.
- Do not redesign the chat around plan, review, batch, or worktree workflows.
- Do not claim that headless mode supports interactive approvals.
- Do not migrate session storage or history in 2.0.

## Follow-on MSP work

1. Add an execution adapter interface that can host both JSONL and MSP.
2. Port the persistent `muse serve` host and JSON-RPC client from
   `muse-code-vscode`.
3. Fold typed MSP notifications into the existing chat state: approvals,
   user input, queued turns, retries, model, usage, todos, and branch.
4. Add reconnect, event paging, cursor-gap recovery, and host lifecycle UI.
5. Only then consider exposing an MSP-backed mode to users.

## Acceptance criteria

- Existing headless prompts, history, tool cards, file mentions, and changed
  file review continue to work.
- Interactive mode is visible, understandable, and opens the terminal path.
- Changing the mode does not silently change approval or sandbox guarantees.
- `bun run check`, `bun test`, and `git diff --check` pass.

## Current architectural decision

MSP is a protocol carried over JSON-RPC, not a replacement for JSON-RPC. The
2.0 seam is therefore a product/execution-mode boundary; it is not yet the MSP
transport implementation.
