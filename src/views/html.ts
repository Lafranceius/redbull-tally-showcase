/** Markup that is already safe and must not be escaped again. */
export type Html = { readonly __html: string };

export const raw = (s: string): Html => ({ __html: s });

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && '__html' in v) return (v as Html).__html;
  return esc(v);
}

/** Tagged template that escapes every interpolation unless it is `Html`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1]!;
  return raw(out);
}

/** Two-digit rank, as the design calls for: 1 → `01`. */
export const rank2 = (n: number) => String(n).padStart(2, '0');
