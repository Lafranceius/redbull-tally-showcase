import { html, type Html } from './html';

/** Up to two letters: first and last word (`Kari Nordmann` → `KN`), or the first letter. */
export function initials(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = (w: string) => [...w][0] ?? '';
  return (words.length > 1 ? first(words[0]!) + first(words.at(-1)!) : first(words[0]!)).toUpperCase();
}

/** Square picture (sharp corners, per the design), or initials when there is none. */
export function avatar(o: { id: number; name: string | null; avatarAt: number | null }, size: 'av-sm' | 'av-lg'): Html {
  if (o.avatarAt) {
    return html`<img class="av ${size}" src="/avatar/${o.id}?v=${o.avatarAt}" alt="" loading="lazy" decoding="async">`;
  }
  return html`<span class="av ${size}" aria-hidden="true">${initials(o.name)}</span>`;
}
