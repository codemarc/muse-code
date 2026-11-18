# Muse Code extension design

## Authority

User-requested Muse branding over the existing VS Code interaction structure. This is an Operate surface: accurate state, readable code, explicit actions and continuity take priority over decoration.

Confirmed assets: https://muse.ai/images/landing/brand/muse-logo.svg and Muse's public landing-page styles, retrieved 2026-11-12. Use the original squiggled m path and its blue gradient (#0082FB, #0064E0, #0040DC), not the former invented crown/circle mark. The brand asset keeps its original artwork; UI variants follow editor icon tinting/high-contrast needs. See media/BRAND.md for provenance.

## Palette and type

Native editor surfaces and body foregrounds maintain theme compatibility. Muse blue owns Send, focus, active selection and branded marks. On dark themes, lighter #70BEFF is used for text accents; on light themes #0064E0. Error/success/warning colors retain their semantic editor tokens. High contrast uses system/editor foregrounds and visible borders.

System UI font for controls and conversation. Editor monospace for actual code/paths only. Comfortable 1.6 line-height for responses; compact but legible 12px secondary controls. No gradient text or decorative animations.

## Composition

A clear brand row with the authentic mark and Muse Code name; a subordinate session row for navigation. Conversation remains an editorial stream: distinct user requests, unboxed assistant prose, compact tool disclosures and durable file review cards. Composer is a persistent, softly outlined surface with a strongly identified Send action and a separate Stop action while running.

The empty state centers the blue mark and one direct invitation. Mode details remain available in the mode picker and a dismissible notice; no decorative metrics or unsupported capabilities.

## States and behavior

Prepare next-message drafts during generation. Send remains disabled until the active turn finishes; Stop never submits the draft. Prior-message reuse loads a draft for explicit review, preserves known attachment requests and never overwrites a non-empty composer. Older context that cannot be reconstructed is clearly identified for reattachment. New session/mode guards, approvals and questions retain their established behavior.

Fit approximately 300px sidebars and editor panels. Wrap action rows instead of clipping them. Keyboard focus is visible; reduced-motion and high-contrast settings take precedence. Local packaged assets only, with a restrictive webview CSP.
