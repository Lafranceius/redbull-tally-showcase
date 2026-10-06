// Shared stylesheet, inlined into every page. Tokens and recipes come from
// .claude/skills/pure-design/SKILL.md: dark-first, peach only for the one main action.

const NOISE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const CSS = `
:root {
  color-scheme: dark;
  --bg: #0b0b0c; --panel: #151517; --panel-2: #1c1c1f;
  --line: #2a2a2e; --line-strong: #3a3a40;
  --text: #f2e9da; --text-muted: #a69e92; --text-dim: #6e6961;
  --peach: #ff9b76; --peach-hover: #ffb091; --peach-ink: #1a0e09; --danger: #ff6b5e;
  --r-control: 2px; --r-shell: 6px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  --ease: cubic-bezier(.2,.8,.2,1);
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; min-height: 100vh; min-height: 100dvh;
  background: var(--bg); color: var(--text);
  font: 400 16px/1.5 var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .035;
  background-image: url("${NOISE}");
}
.wrap {
  position: relative; max-width: 480px; margin: 0 auto;
  padding: max(var(--s5), env(safe-area-inset-top)) var(--s4) var(--s7);
}
.wrap.wide { max-width: 960px; }
.center { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; justify-content: center; }
h1 { font-size: 28px; font-weight: 600; letter-spacing: -.01em; line-height: 1.2; margin: 0 0 var(--s4); }
h2 { font-size: 24px; font-weight: 600; letter-spacing: -.01em; line-height: 1.25; margin: 0 0 var(--s4); }
p { margin: 0 0 var(--s4); }
a { color: var(--text); }
.label {
  display: block; margin: 0 0 var(--s2);
  font: 500 12px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted);
}
.muted { color: var(--text-muted); }
.dim { color: var(--text-dim); }
.small { font-size: 14px; }
.peach { color: var(--peach); }
.err { color: var(--danger); }
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.hero {
  margin: var(--s2) 0; font: 600 88px/1 var(--font-mono);
  font-variant-numeric: tabular-nums; letter-spacing: -.03em;
}
.big { font: 600 40px/1.1 var(--font-mono); font-variant-numeric: tabular-nums; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-shell);
  padding: var(--s5); box-shadow: inset 0 1px 0 rgb(255 255 255 / .04);
}
.stack > * + * { margin-top: var(--s4); }
.stack > p { margin-bottom: 0; }
.section { margin-top: var(--s6); }
.section:first-child { margin-top: 0; }
.row { display: flex; gap: var(--s3); align-items: center; }
.row > * { flex: 1; }
.btn {
  display: flex; align-items: center; justify-content: center; gap: var(--s2);
  width: 100%; min-height: 56px; padding: 0 var(--s4);
  border: 1px solid var(--line-strong); border-radius: var(--r-control);
  background: transparent; color: var(--text); cursor: pointer; text-decoration: none;
  font: 600 14px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .06em;
  transition: background-color 140ms var(--ease), transform 140ms var(--ease), opacity 140ms var(--ease);
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.btn:hover { background: var(--panel-2); }
.btn:active { transform: scale(.98); }
.btn.primary { background: var(--peach); border-color: var(--peach); color: var(--peach-ink); }
.btn.primary:hover, .btn.primary:active { background: var(--peach-hover); border-color: var(--peach-hover); }
.btn.danger { color: var(--danger); border-color: var(--danger); }
.btn.sm { width: auto; min-height: 40px; padding: 0 var(--s3); font-size: 12px; }
.btn:disabled { opacity: .5; cursor: default; }
form.inline { display: inline; }
input, select, textarea {
  width: 100%; min-height: 48px; padding: var(--s3);
  background: var(--panel); color: var(--text);
  border: 1px solid var(--line); border-radius: var(--r-control);
  font: 400 16px/1.4 var(--font-sans);
}
textarea { min-height: 120px; resize: vertical; }
input:focus, select:focus, textarea:focus { border-color: var(--peach); outline: 2px solid var(--peach); outline-offset: 2px; }
:focus-visible { outline: 2px solid var(--peach); outline-offset: 2px; }
.code {
  font: 600 32px/1 var(--font-mono); letter-spacing: .5em; text-align: center;
  text-indent: .5em; min-height: 64px;
}
.tabs {
  display: flex; gap: 2px; padding: 2px;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-control);
}
.tabs a {
  flex: 1; padding: var(--s3) var(--s2); text-align: center; text-decoration: none;
  border-radius: var(--r-control); color: var(--text-muted);
  font: 500 12px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em;
}
.tabs a[aria-current] { background: var(--panel-2); color: var(--text); }
.links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 var(--s5); }
.links a, .textlink, .links button {
  padding: var(--s3) 0; background: none; border: 0; cursor: pointer; text-decoration: none; color: var(--text-muted);
  font: 500 12px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em;
}
.links a:hover, .textlink:hover { color: var(--text); }
.rows { list-style: none; margin: 0; padding: 0; }
.rows li { display: flex; align-items: center; gap: var(--s3); min-height: 48px; padding: var(--s2) 0; border-bottom: 1px solid var(--line); }
.rows li:last-child { border-bottom: 0; }
.rows .rank { width: 3ch; color: var(--text-muted); }
.rows .top .rank, .rows .top .name { color: var(--text); font-weight: 600; }
.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r { text-align: right; white-space: nowrap; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th {
  position: sticky; top: 0; background: var(--panel); text-align: left; white-space: nowrap;
  font: 500 12px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted);
}
th, td { padding: var(--s2); border-bottom: 1px solid var(--line); vertical-align: middle; }
tr.off td { color: var(--text-dim); }
.nav { display: flex; flex-wrap: wrap; gap: 0 var(--s4); margin-bottom: var(--s5); }
.nav a { padding: var(--s2) 0; text-decoration: none; color: var(--text-muted); font: 500 12px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
.nav a[aria-current] { color: var(--text); }
.grid { display: grid; gap: var(--s4); grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.flash { margin: 0 0 var(--s5); padding: var(--s3) var(--s4); background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--r-shell); }
details > summary { list-style: none; cursor: pointer; }
details > summary::-webkit-details-marker { display: none; }
.tag { font: 500 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); }
.av {
  display: inline-flex; align-items: center; justify-content: center; flex: none; overflow: hidden;
  border: 1px solid var(--line); border-radius: var(--r-control); background: var(--panel-2); object-fit: cover;
  font: 600 12px/1 var(--font-mono); color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em;
}
.av-sm { width: 32px; height: 32px; }
.av-lg { width: 56px; height: 56px; font-size: 18px; }
.me-head { display: flex; align-items: center; gap: var(--s4); }
.check { display: flex; align-items: flex-start; gap: var(--s3); cursor: pointer; line-height: 1.4; }
.check input { flex: none; width: 24px; height: 24px; min-height: 0; margin: 0; padding: 0; accent-color: var(--peach); }
[hidden] { display: none !important; }
@keyframes pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
@keyframes up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.pop { animation: pop 160ms var(--ease); }
.up { animation: up 160ms var(--ease); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
@media (min-width: 900px) {
  .tv .wrap { max-width: 960px; }
  .tv { font-size: 24px; }
  .tv h1 { font-size: 42px; }
  .tv .big { font-size: 60px; }
  .tv .label, .tv .tabs a, .tv .links a { font-size: 18px; }
  .tv .rows { columns: 2; column-gap: var(--s6); }
  .tv .rows li { break-inside: avoid; min-height: 72px; border-bottom: 1px solid var(--line); }
  .tv .av-sm { width: 48px; height: 48px; font-size: 16px; }
}
@media (min-width: 1600px) {
  .tv .wrap { max-width: 1400px; }
  .tv { font-size: 34px; }
  .tv h1 { font-size: 60px; }
  .tv .big { font-size: 96px; }
  .tv .label, .tv .tabs a, .tv .links a { font-size: 24px; }
  .tv .rows li { min-height: 96px; }
  .tv .av-sm { width: 64px; height: 64px; font-size: 20px; }
}
`;

/** The stylesheet with line breaks and indentation collapsed. */
export const STYLE = CSS.replace(/\s*\n\s*/g, ' ').trim();
