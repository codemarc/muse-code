# Tool Card Progressive Disclosure

## Problem

Muse CLI Chat currently renders every tool result as a visible output card. Long
results are truncated to 12 lines or 800 characters, but every card still shows
an output body, controls, and file chips. A run with several tools therefore
pushes the useful conversation out of view even when the user does not need the
tool details.

The output itself should remain complete and available. The problem is its
default disclosure in the transcript.

## Desired experience

Completed tool calls appear as one-line disclosure rows by default:

```text
▸ Read text file CHANGELOG.md                         exit 0
▸ Check git history since last changelog              exit 0
```

Clicking or keyboard-activating a row expands the existing tool card:

```text
▾ Read text file CHANGELOG.md                         exit 0
  [Readable] [Raw] [Open in canvas]

  Read text file CHANGELOG.md.
  1|# Changelog
  ...

  [CHANGELOG.md] [SECURITY.md] [PRIVACY.md] [auth.json]
```

Activating it again returns it to one line. No tool card opens itself, including
failed calls. A failure stays folded with a red failure badge.

## Setting

Add `muse.toolDisplay` as a three-value setting:

| Value | Initial tool-card state |
|---|---|
| `compact` | Every tool card is folded. This is the default. |
| `balanced` | Results at or below the existing 12-line and 800-character preview limits are open; longer results are folded. |
| `detailed` | Every tool card is open. |

The setting applies to new live tool calls and cards restored through History.
Changing it updates the default presentation of cards in the current
transcript. A card that the user manually opened or folded keeps that explicit
state until the transcript is rebuilt.

`muse.toolOutputFormat` remains independent. It selects Readable or Raw content
inside an open card; it does not control whether the card is open.

## Collapsed summary

Choose the summary text using the first useful source in this order:

1. Human-readable tool description.
2. First non-empty line of Readable output.
3. Shortened command.
4. Friendly tool name.

Opaque call identifiers such as `CALL_01A023F` are not shown when a better
summary exists. Summary text stays on one line and truncates visually when the
sidebar is narrow.

The folded row includes an exit badge when an exit code is available. Successful
badges are muted. Failed badges are red, but failures remain folded until the
user asks for details.

## Expanded content

Opening a card reveals the current tool-card content without removing
capabilities:

- Readable and Raw toggles.
- Open in canvas.
- The output body.
- The existing secondary Expand/Collapse control for output beyond the preview
  limit.
- Verified file chips.

All controls and file chips are hidden while the card is folded.

## State and data flow

The extension host sends the selected `muse.toolDisplay` value to the chat
webview alongside the existing display configuration. The webview derives each
card's initial open state from that setting and the active output length.

Each card stores two presentation values locally:

- Whether it is currently open.
- Whether the user has manually overridden its initial state.

Configuration changes recompute only cards without a manual override. Rebuilding
the transcript from History creates fresh card presentation state using the
current setting.

No session record or Muse event format changes. Tool execution, stored output,
history hydration, canvas routing, and file validation remain unchanged.

## Accessibility and interaction

The summary is a real button or equivalent keyboard-operable disclosure control.
It exposes its open state with `aria-expanded`, has a visible focus treatment,
and does not nest the expanded action buttons inside the disclosure button.

## Error handling

- Failed tool calls remain folded and expose failure through the red badge.
- Cards with empty output can still expand when controls or metadata are
  available.
- If no useful description, readable line, command, or friendly name exists,
  use `Tool result` rather than an opaque call identifier.
- Canvas and link errors retain their existing behavior after the card opens.

## Verification

Behavioral webview tests will cover:

- Compact, Balanced, and Detailed initial states.
- The existing 12-line and 800-character Balanced thresholds.
- Summary-source priority and opaque-ID fallback.
- Success and folded failure badges.
- Mouse and keyboard disclosure toggling.
- Controls, output, and file chips hidden while folded and restored when open.
- Manual card overrides surviving configuration changes.
- Fresh setting application when History rebuilds the transcript.
- Existing Readable/Raw and Open in canvas behavior after expansion.

Run the full typecheck, test suite, and production build after implementation.

## Non-goals

- Shortening, filtering, or discarding Muse tool output.
- Changing assistant or user messages.
- Persisting individual card open states across transcript rebuilds or extension
  restarts.
- Adding multiple threshold or failure-expansion settings.
- Adding a session toolbar control in this iteration.
