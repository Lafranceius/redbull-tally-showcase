import type { Can, Settlement, User } from '../store';
import { formatDateTime, formatKr, formatMonth } from '../time';
import { avatar } from './avatar';
import { html, raw, type Html } from './html';
import { page } from './layout';

const NAV: Array<[string, string]> = [
  ['/admin', 'Oversikt'],
  ['/admin/month', 'Måned'],
  ['/admin/members', 'Medlemmer'],
  ['/admin/users', 'Brukere'],
  ['/admin/entries', 'Bokser'],
  ['/admin/payments', 'Betalinger'],
  ['/admin/log', 'Logg'],
];

function adminPage(o: { nonce: string; path: string; title: string; flash?: string; body: Html }): string {
  return page({
    title: `${o.title} · Admin`,
    nonce: o.nonce,
    wide: true,
    body: html`<nav class="nav">${NAV.map(
      ([href, label]) => html`<a href="${href}"${href === o.path ? raw(' aria-current="page"') : ''}>${label}</a>`,
    )}<a href="/me">Min side</a></nav>
${o.flash ? html`<p class="flash small" role="status">${o.flash}</p>` : ''}
<h1>${o.title}</h1>
${o.body}`,
  });
}

/** A destructive action that needs a second, explicit tap. No alert()/confirm(). */
function confirmButton(action: string, label: string, confirmLabel: string, hidden: Record<string, string> = {}): Html {
  return html`<details><summary class="btn sm danger">${label}</summary><form method="post" action="${action}" style="margin-top:var(--s2)">${Object.entries(hidden).map(
    ([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`,
  )}<button class="btn sm danger">${confirmLabel}</button></form></details>`;
}

const name = (n: string | null) => n ?? html`<span class="dim">(uten navn)</span>`;

function monthOptions(months: string[], selected: string | undefined, includeAll: boolean): Html {
  return html`${includeAll ? html`<option value="">Alle måneder</option>` : ''}${months.map(
    (m) => html`<option value="${m}"${m === selected ? raw(' selected') : ''}>${m}</option>`,
  )}`;
}

function userOptions(users: User[], selected: number | undefined, placeholder: string): Html {
  return html`<option value="">${placeholder}</option>${users.map(
    (u) => html`<option value="${u.id}"${u.id === selected ? raw(' selected') : ''}>${u.display_name ?? u.email}</option>`,
  )}`;
}

// ── overview ────────────────────────────────────────────────────────────────

export function overviewPage(o: {
  nonce: string;
  flash?: string;
  priceOre: number;
  month: string;
  officeCount: number;
  officeOre: number;
  drinkers: number;
  email: { today: number; month: number; last24h: number; perDay: number; perMonth: number; cap: number };
}): string {
  return adminPage({
    nonce: o.nonce,
    path: '/admin',
    title: 'Admin',
    flash: o.flash,
    body: html`<div class="grid">
<form class="panel stack" method="post" action="/admin/price">
<span class="label">Pris per boks</span>
<p class="big" style="margin:0">${formatKr(o.priceOre)}</p>
<label class="label" for="kr">Ny pris i kr</label>
<input id="kr" name="kr" inputmode="decimal" placeholder="10" required>
<button class="btn primary">Lagre pris</button>
<p class="muted small">Gjelder bare nye bokser. Gamle bokser beholder prisen de ble logget med.</p>
</form>
<section class="panel stack">
<span class="label">${formatMonth(o.month)}</span>
<p class="big" style="margin:0"><span class="num">${o.officeCount}</span> bokser</p>
<p class="muted"><span class="num">${formatKr(o.officeOre)}</span> totalt · <span class="num">${o.drinkers}</span> ${o.drinkers === 1 ? 'person' : 'personer'}</p>
<a class="btn" href="/admin/month?m=${o.month}">Månedsoversikt</a>
</section>
<section class="panel">
<span class="label">E-post (innloggingskoder)</span>
<table><tbody>
<tr><td>I dag</td><td class="num r">${o.email.today} / ${o.email.perDay}</td></tr>
<tr><td>Denne måneden</td><td class="num r">${o.email.month} / ${o.email.perMonth}</td></tr>
<tr><td>Siste 24 t (egen grense)</td><td class="num r">${o.email.last24h} / ${o.email.cap}</td></tr>
</tbody></table>
<p class="muted small" style="margin-top:var(--s3)">Resend Free: 100 per dag og 3000 per måned. Kontoen kan også sende annen e-post.</p>
</section>
</div>`,
  });
}

// ── month ───────────────────────────────────────────────────────────────────

export function monthPage(o: {
  nonce: string;
  month: string;
  months: string[];
  rows: Array<{ name: string | null; email: string; active: number; count: number; ore: number }>;
}): string {
  const totalCount = o.rows.reduce((s, r) => s + r.count, 0);
  const totalOre = o.rows.reduce((s, r) => s + r.ore, 0);
  return adminPage({
    nonce: o.nonce,
    path: '/admin/month',
    title: `Måned: ${formatMonth(o.month)}`,
    body: html`<form class="panel row" method="get" action="/admin/month">
<select name="m" aria-label="Måned">${monthOptions(o.months, o.month, false)}</select>
<button class="btn sm" style="flex:0">Vis</button>
<a class="btn sm" style="flex:0;white-space:nowrap" href="/admin/month.csv?m=${o.month}">Eksporter CSV</a>
</form>
<div class="scroll section"><table>
<thead><tr><th>Navn</th><th>E-post</th><th class="r">Bokser</th><th class="r">Beløp</th></tr></thead>
<tbody>${o.rows.map(
      (r) => html`<tr${r.active ? '' : raw(' class="off"')}><td>${name(r.name)}</td><td>${r.email}</td><td class="num r">${r.count}</td><td class="num r">${formatKr(r.ore)}</td></tr>`,
    )}
<tr><td><strong>Totalt</strong></td><td></td><td class="num r"><strong>${totalCount}</strong></td><td class="num r"><strong>${formatKr(totalOre)}</strong></td></tr>
</tbody></table></div>
${o.rows.length ? '' : html`<p class="muted">Ingen bokser denne måneden.</p>`}`,
  });
}

// ── members ─────────────────────────────────────────────────────────────────

export function membersPage(o: {
  nonce: string;
  flash?: string;
  adminEmail: string;
  members: Array<{ email: string; added_at: number; user_id: number | null; display_name: string | null; active: number | null }>;
}): string {
  return adminPage({
    nonce: o.nonce,
    path: '/admin/members',
    title: `Medlemmer (${o.members.length})`,
    flash: o.flash,
    body: html`<form class="panel stack" method="post" action="/admin/members/add">
<label class="label" for="emails">Legg til e-poster</label>
<textarea id="emails" name="emails" placeholder="ola@example.com&#10;kari@example.com" required></textarea>
<p class="muted small">Én eller flere, skilt med linjeskift, komma eller semikolon.</p>
<button class="btn primary">Legg til</button>
</form>
<p class="muted small section">Å fjerne en e-post deaktiverer brukeren og logger dem ut overalt. Historikken beholdes.</p>
<div class="scroll"><table>
<thead><tr><th>E-post</th><th>Bruker</th><th>Lagt til</th><th></th></tr></thead>
<tbody>${o.members.map(
      (m) => html`<tr><td>${m.email}</td><td>${m.user_id ? html`${name(m.display_name)}${m.active ? '' : html` <span class="tag">deaktivert</span>`}` : html`<span class="dim">ikke logget inn</span>`}</td><td class="num">${formatDateTime(m.added_at).slice(0, 10)}</td><td class="r">${
        m.email === o.adminEmail ? html`<span class="tag">admin</span>` : confirmButton('/admin/members/remove', 'Fjern', 'Bekreft fjerning', { email: m.email })
      }</td></tr>`,
    )}</tbody></table></div>`,
  });
}

// ── users ───────────────────────────────────────────────────────────────────

export function usersPage(o: {
  nonce: string;
  flash?: string;
  adminEmail: string;
  users: Array<User & { member: number; cans: number; sessions: number; avatar_at: number | null }>;
}): string {
  return adminPage({
    nonce: o.nonce,
    path: '/admin/users',
    title: `Brukere (${o.users.length})`,
    flash: o.flash,
    body: html`<div class="scroll"><table>
<thead><tr><th>Navn</th><th>E-post</th><th class="r">Bokser</th><th class="r">Økter</th><th>Status</th><th></th></tr></thead>
<tbody>${o.users.map(
      (u) => html`<tr${u.active ? '' : raw(' class="off"')}>
<td><form class="row" method="post" action="/admin/users/${u.id}/rename">${avatar({ id: u.id, name: u.display_name, avatarAt: u.avatar_at }, 'av-sm')}<input name="name" value="${u.display_name ?? ''}" minlength="2" maxlength="20" required aria-label="Navn" style="min-height:40px;min-width:9em"><button class="btn sm" style="flex:0">Lagre</button></form></td>
<td>${u.email}</td><td class="num r">${u.cans}</td><td class="num r">${u.sessions}</td>
<td>${u.active ? 'Aktiv' : 'Deaktivert'}${u.member ? '' : html` <span class="tag">ikke medlem</span>`}</td>
<td class="r"><div class="row" style="justify-content:flex-end">${
        u.email === o.adminEmail
          ? html`<span class="tag">admin</span>`
          : u.active
            ? confirmButton(`/admin/users/${u.id}/active`, 'Deaktiver', 'Bekreft', { active: '0' })
            : html`<form method="post" action="/admin/users/${u.id}/active"><input type="hidden" name="active" value="1"><button class="btn sm">Aktiver</button></form>`
      }${u.sessions ? confirmButton(`/admin/users/${u.id}/logout`, 'Logg ut', 'Logg ut overalt') : ''}${
        u.avatar_at ? confirmButton(`/admin/users/${u.id}/avatar/delete`, 'Fjern bilde', 'Bekreft') : ''
      }</div></td>
</tr>`,
    )}</tbody></table></div>`,
  });
}

// ── entries ─────────────────────────────────────────────────────────────────

export function entriesPage(o: {
  nonce: string;
  flash?: string;
  months: string[];
  users: User[];
  filter: { month?: string; userId?: number; status: 'all' | 'active' | 'deleted'; page: number };
  rows: Array<Can & { name: string | null; email: string }>;
  hasMore: boolean;
  query: (page: number) => string;
}): string {
  const f = o.filter;
  const statusOpt = (v: string, label: string) => html`<option value="${v}"${f.status === v ? raw(' selected') : ''}>${label}</option>`;
  return adminPage({
    nonce: o.nonce,
    path: '/admin/entries',
    title: 'Bokser',
    flash: o.flash,
    body: html`<div class="grid">
<form class="panel stack" method="get" action="/admin/entries">
<span class="label">Filter</span>
<select name="month" aria-label="Måned">${monthOptions(o.months, f.month, true)}</select>
<select name="user" aria-label="Bruker">${userOptions(o.users, f.userId, 'Alle brukere')}</select>
<select name="status" aria-label="Status">${statusOpt('active', 'Aktive')}${statusOpt('deleted', 'Slettede')}${statusOpt('all', 'Alle')}</select>
<button class="btn">Filtrer</button>
</form>
<form class="panel stack" method="post" action="/admin/cans/add">
<span class="label">Legg til glemt boks</span>
<select name="user_id" required aria-label="Bruker">${userOptions(o.users.filter((u) => u.active), undefined, 'Velg bruker')}</select>
<div class="row"><input name="count" type="number" min="1" max="20" value="1" aria-label="Antall"><input name="date" type="date" aria-label="Dato (valgfri)"></div>
<p class="muted small">Uten dato havner boksen på i dag. Prisen er dagens pris.</p>
<button class="btn primary">Legg til</button>
</form>
</div>
<form id="bulk" method="post" action="/admin/cans/delete"></form>
<div class="row section" style="justify-content:flex-start">
<details><summary class="btn sm danger">Slett valgte</summary><button class="btn sm danger" form="bulk" style="margin-top:var(--s2)">Bekreft sletting av valgte</button></details>
<span class="muted small" style="flex:1">Kryss av bokser i lista, så slett alle på en gang.</span>
</div>
<div class="scroll"><table>
<thead><tr><th></th><th>#</th><th>Tid</th><th>Navn</th><th>Måned</th><th class="r">Pris</th><th>Status</th><th></th></tr></thead>
<tbody>${o.rows.map(
      (c) => html`<tr${c.deleted_at ? raw(' class="off"') : ''}><td>${c.deleted_at ? '' : html`<input type="checkbox" name="ids" value="${c.id}" form="bulk" aria-label="Velg boks ${c.id}" style="width:20px;min-height:20px;height:20px;accent-color:var(--peach)">`}</td><td class="num">${c.id}</td><td class="num">${formatDateTime(c.created_at)}</td><td>${name(c.name)}${c.created_by_admin ? html` <span class="tag">admin</span>` : ''}</td><td class="num">${c.month}</td><td class="num r">${formatKr(c.price_ore)}</td><td>${c.deleted_at ? 'Slettet' : 'Aktiv'}${c.settlement_id ? html` <span class="tag">betalt</span>` : ''}</td><td class="r">${
        c.deleted_at
          ? html`<form method="post" action="/admin/cans/${c.id}/restore"><button class="btn sm">Gjenopprett</button></form>`
          : confirmButton(`/admin/cans/${c.id}/delete`, 'Slett', 'Bekreft')
      }</td></tr>`,
    )}</tbody></table></div>
${o.rows.length ? '' : html`<p class="muted">Ingen bokser med dette filteret.</p>`}
<nav class="links section">${f.page > 0 ? html`<a href="${o.query(f.page - 1)}">Forrige side</a>` : ''}${o.hasMore ? html`<a href="${o.query(f.page + 1)}">Neste side</a>` : ''}</nav>`,
  });
}

// ── payments ────────────────────────────────────────────────────────────────

export function paymentsPage(o: {
  nonce: string;
  flash?: string;
  summary: Array<{ user_id: number; name: string | null; email: string; active: number; bought_count: number; bought_ore: number; cleared_ore: number; owed_ore: number }>;
  settlements: Array<Settlement & { name: string | null; email: string }>;
}): string {
  const total = (k: 'bought_ore' | 'cleared_ore' | 'owed_ore') => o.summary.reduce((s, r) => s + r[k], 0);
  return adminPage({
    nonce: o.nonce,
    path: '/admin/payments',
    title: 'Betalinger',
    flash: o.flash,
    body: html`<p class="muted small">Brukerne trykker «Jeg har betalt» når de har betalt. Det nullstiller gjelda deres, men du ser alt her og i månedsoversikten.</p>
<span class="label section">Per person</span>
<div class="scroll"><table>
<thead><tr><th>Navn</th><th class="r">Bokser</th><th class="r">Kjøpt</th><th class="r">Nullstilt</th><th class="r">Utestående</th></tr></thead>
<tbody>${o.summary.map(
      (r) => html`<tr${r.active ? '' : raw(' class="off"')}><td>${name(r.name)}</td><td class="num r">${r.bought_count}</td><td class="num r">${formatKr(r.bought_ore)}</td><td class="num r">${formatKr(r.cleared_ore)}</td><td class="num r">${formatKr(r.owed_ore)}</td></tr>`,
    )}
<tr><td><strong>Totalt</strong></td><td></td><td class="num r"><strong>${formatKr(total('bought_ore'))}</strong></td><td class="num r"><strong>${formatKr(total('cleared_ore'))}</strong></td><td class="num r"><strong>${formatKr(total('owed_ore'))}</strong></td></tr>
</tbody></table></div>
<span class="label section">Nullstillinger</span>
${o.settlements.length
  ? html`<div class="scroll"><table>
<thead><tr><th>Tid</th><th>Navn</th><th class="r">Bokser</th><th class="r">Beløp</th><th>Status</th><th></th></tr></thead>
<tbody>${o.settlements.map(
      (s) => html`<tr${s.reversed_at ? raw(' class="off"') : ''}><td class="num">${formatDateTime(s.at)}</td><td>${name(s.name)}</td><td class="num r">${s.cans}</td><td class="num r">${formatKr(s.amount_ore)}</td><td>${s.reversed_at ? 'Angret' : 'Betalt'}</td><td class="r">${
        s.reversed_at ? '' : confirmButton(`/admin/settlements/${s.id}/reverse`, 'Angre', 'Bekreft: gjør gjelda utestående igjen')
      }</td></tr>`,
    )}</tbody></table></div>`
  : html`<p class="muted">Ingen har nullstilt gjeld ennå.</p>`}`,
  });
}

// ── log ─────────────────────────────────────────────────────────────────────

export function logPage(o: { nonce: string; rows: Array<{ at: number; action: string; details_json: string }> }): string {
  return adminPage({
    nonce: o.nonce,
    path: '/admin/log',
    title: 'Logg',
    body: html`<p class="muted small">De siste 100 admin-handlingene.</p>
<div class="scroll"><table>
<thead><tr><th>Tid</th><th>Handling</th><th>Detaljer</th></tr></thead>
<tbody>${o.rows.map(
      (r) => html`<tr><td class="num">${formatDateTime(r.at)}</td><td class="num">${r.action}</td><td class="small" style="word-break:break-all">${r.details_json}</td></tr>`,
    )}</tbody></table></div>`,
  });
}
