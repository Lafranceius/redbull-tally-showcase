---
name: pure-design
description: Visual design system for the Red Bull tally web app — dark-first, near-black surfaces, raised charcoal panels, vivid peach actions, warm cream type, sharp controls, monospace uppercase labels. Load before writing or changing any HTML, CSS or UI copy layout in this project.
---

# Pure-style design system (Red Bull tally)

A dark, technical, precise look in the spirit of TypeUI's "Pure" design skill (typeui.sh/design-skills/pure). It's built from Pure's public description, not its paid skill file:
- near-black surface with subtly raised charcoal panels
- vivid peach reserved for intentional actions and emphasis
- warm cream text
- sharp controls inside compact 6px shells
- monospace uppercase labels

The result should feel exact and production-ready. Never glossy, never bubbly.

If the official Pure `SKILL.md` is later placed next to this file, it takes precedence. Keep the project constraints from the project spec either way: no external fonts or CDNs, pages under about 30 KB, and Norwegian copy.

## Tokens

Define all of these once, as CSS custom properties on `:root`, in a single inlined stylesheet shared by every page. The app is dark-only: set `color-scheme: dark`, and `<meta name="theme-color" content="#0b0b0c">`.

```css
:root {
  color-scheme: dark;
  /* surfaces */
  --bg: #0b0b0c;          /* near-black page surface */
  --panel: #151517;       /* raised charcoal panel */
  --panel-2: #1c1c1f;     /* hover / nested panel */
  --line: #2a2a2e;        /* default border */
  --line-strong: #3a3a40; /* focused/hovered border */
  /* text */
  --text: #f2e9da;        /* warm cream: headings and body */
  --text-muted: #a69e92;  /* secondary text (≈7:1 on --bg) */
  --text-dim: #6e6961;    /* meta only, never essential info */
  /* brand */
  --peach: #ff9b76;       /* primary action + key emphasis */
  --peach-hover: #ffb091;
  --peach-ink: #1a0e09;   /* text on peach */
  --danger: #ff6b5e;
  /* shape */
  --r-control: 2px;       /* buttons, inputs, tabs: sharp */
  --r-shell: 6px;         /* panels, cards, toasts */
  /* type */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  /* spacing: 4px base */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  --ease: cubic-bezier(.2,.8,.2,1);
}
```

**Grain:** give `--bg` a very faint noise texture, using a tiny inline SVG `feTurbulence` data URI on `body::before` at `opacity: .035` with `pointer-events: none`. Keep it under 1 KB, and leave it out if it hurts performance on low-end phones.

## Typography

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Label / eyebrow | mono | 12px / 500 | UPPERCASE, `letter-spacing: .08em`, `--text-muted` |
| Body | sans | 16px / 400, line-height 1.5 | `--text` |
| Small / meta | sans | 14px / 400 | `--text-muted` |
| Heading | sans | 24–28px / 600, `letter-spacing: -.01em` | `--text` |
| Hero number | mono | 72–96px / 600, `font-variant-numeric: tabular-nums` | Can count on the scan screen |
| Data / numbers | mono | inherit size, tabular-nums | Ranks, counts, kr, dates |

- Never use pure white (`#fff`) or pure black (`#000`).
- All numbers are monospace with tabular figures, so columns line up.
- Write ranks as two digits: `01`, `02`, `03`.

## Surfaces and layout

- **Page:** `--bg`, a single column, `max-width: 480px` on phones and centered, with 16px side gutters. The leaderboard TV view may go up to 960px.
- **Panel:** `--panel` with a 1px `--line` border, `--r-shell` radius, `--s5` padding, and `box-shadow: inset 0 1px 0 rgb(255 255 255 / .04)`. Raised means slightly lighter plus a top highlight; there are no drop shadows.
- **Section rhythm:** `--s6` between sections and `--s4` within them. Keep it consistent.
- **Dividers:** 1px `--line`. Don't use dividers and panel borders at the same time.

## Controls (sharp)

All controls use `--r-control` (2px).

**Primary button** (the one main action per view):
- `--peach` background, `--peach-ink` text.
- Minimum height 56px on mobile, full width.
- Label: mono, 14px, 600 weight, uppercase, `.06em` tracking.
- Hover and active states use `--peach-hover`.

**Secondary button:**
- Transparent background, 1px `--line-strong` border, `--text` text, same size as primary.
- Hover: `--panel-2` background.

**Destructive** (delete or deactivate in admin): like secondary, but with `--danger` text and border.

**Input:**
- 48px tall, `--panel` background, 1px `--line` border, 16px text (so iOS doesn't zoom).
- Focus: `--peach` border plus `outline: 2px solid var(--peach); outline-offset: 2px`.

**6-digit code input:**
- A single input, mono, 32px, `letter-spacing: .5em`, centered.
- `inputmode="numeric"` and `autocomplete="one-time-code"`.

**Tabs / segmented control:**
- A row of mono uppercase 12px labels inside a `--panel` shell with a 1px `--line` border.
- The active tab gets `--panel-2` background and `--text`. Inactive tabs use `--text-muted`.
- Peach is not used for tabs.

**Focus:** every interactive element shows a visible 2px peach outline on `:focus-visible`.

## Peach discipline

Peach is the only accent. Use it for:
- the single primary action on a screen
- the user's own rank or highlighted row
- the "✅" success moment

**Never** use it for:
- backgrounds of large areas
- body text
- borders on everything
- more than one button per view

## Motion

- Use 120–160ms with `var(--ease)`, for opacity and transform only.
- The success state may scale the hero number from 0.96 to 1.
- The undo toast slides up 8px.
- Wrap everything in `@media (prefers-reduced-motion: reduce)`, which turns motion off.

## Screen recipes for this app

**`/scan` success**
1. A full-height centered column.
2. A mono eyebrow, `LOGGET`, then the hero can count for the month ("14") with "bokser denne måneden · 140 kr" under it in `--text-muted`.
3. Below that, the rank as `#03 DENNE MÅNEDEN` in mono, with the number in peach.
4. Actions, stacked: **Angre** (secondary, shown big for 10 s) and **+1 til** (primary peach).
5. Links to the leaderboard and Min side as mono uppercase 12px text links.

**`/scan` recent-guard prompt:** a panel with the question, then one primary button ("LOGG EN TIL") and one secondary ("NEI").

**`/login`**
1. One panel with a mono label `E-POST` and an input, then a primary button `SEND KODE`.
2. Then the code step, with the label `KODE`, the big code input and the button `LOGG INN`.
3. For new users, a third step with the label `VISNINGSNAVN`.

**`/me`**
- A hero panel with the month's count and kr, and the primary button `+1 RED BULL`.
- History as a compact table: mono month (`2026-10`), count and kr, right-aligned.
- This month's cans as rows with a small destructive "Slett".

**`/leaderboard`**
- Tabs: `DENNE MÅNEDEN` and `TOTALT`.
- Rows are `rank · name · count`, with mono rank and count, and `--line` dividers.
- Ranks 01–03 get `--text` with weight 600; the rest use `--text-muted` ranks.
- The office total sits in the header panel in mono.
- TV view (wide screens): scale the type up about 1.5× and allow two columns of rows.

**`/admin`**
- Dense data tables: 14px sans, mono numbers, sticky header with mono uppercase column labels.
- Filters in a top panel. CSV export is a secondary button. Destructive actions are confirmed inline, never with `alert()` or `confirm()`.

## Don'ts

- No gradients or glassmorphism, no glow, no colored drop shadows.
- No radius above 6px, no pill buttons, no circular avatars with colored rings.
- No external fonts, icon fonts or CDNs. Use emoji or inline SVG, sized to the text.
- No light theme.
- No Red Bull logos, colors copied from their branding, or trademark assets.
- No centered body paragraphs longer than two lines.
- No more than one peach element competing for attention on a screen.
