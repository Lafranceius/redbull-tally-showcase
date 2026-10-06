import type { CanStats } from '../cans';
import { LIMITS } from '../config';
import type { BoardRow, Can, Settlement, User } from '../store';
import { formatDate, formatDateTime, formatKr, formatStamp } from '../time';
import { avatar } from './avatar';
import { html, raw, rank2, type Html } from './html';
import { page } from './layout';

const err = (msg: string | undefined) => (msg ? html`<p class="err small" role="alert">${msg}</p>` : '');
const enc = encodeURIComponent;
const bokser = (n: number) => (n === 1 ? 'boks' : 'bokser');

// Shared by /scan and /me. Generates the Idempotency-Key per can, even on browsers without randomUUID.
const UUID_JS =
  "const uuid=()=>crypto.randomUUID?crypto.randomUUID():[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');";

// ── login ───────────────────────────────────────────────────────────────────

export function loginEmailPage(o: { nonce: string; next: string; email?: string; error?: string }): string {
  return page({
    title: 'Logg inn',
    nonce: o.nonce,
    body: html`<div class="center">
<header class="section">
<span class="label">Red Bull · Logg inn</span>
<h1>Logg inn én gang, så går resten av seg selv.</h1>
<p class="muted">Skriv inn jobb-e-posten din, så sender vi deg en kode.</p>
</header>
<form class="panel stack" method="post" action="/login">
<label class="label" for="email">E-post</label>
<input id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required autofocus value="${o.email ?? ''}">
<input type="hidden" name="next" value="${o.next}">
${err(o.error)}
<button class="btn primary">Send kode</button>
</form>
<nav class="links section"><a href="/leaderboard">Toppliste</a></nav>
</div>`,
  });
}

export function loginCodePage(o: { nonce: string; email: string; next: string; error?: string }): string {
  return page({
    title: 'Skriv inn koden',
    nonce: o.nonce,
    body: html`<div class="center">
<header class="section">
<span class="label">Sjekk e-posten</span>
<h1>Skriv inn koden</h1>
<p>Hvis du står på lista, har du fått en kode på mail.</p>
<p class="muted small">Koden står i emnet: «Red Bull-koden din: 123456». Den gjelder i 10 minutter.</p>
<p class="muted small">Ingen kode? Sjekk søppelpost. Du får maks ${LIMITS.codesPerEmail.max} koder i timen, så bruk koden fra den nyeste e-posten.</p>
</header>
<form class="panel stack" method="post" action="/login/verify" id="f">
<input type="hidden" name="email" value="${o.email}">
<input type="hidden" name="next" value="${o.next}">
<label class="label" for="code">Kode</label>
<input id="code" name="code" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
${err(o.error)}
<button class="btn primary">Logg inn</button>
</form>
<nav class="links section"><a href="/login?next=${enc(o.next)}">Bruk en annen e-post</a></nav>
</div>`,
    // Submit as soon as six digits are typed or autofilled.
    script:
      "const c=document.getElementById('code'),f=document.getElementById('f');let sent=false;c.addEventListener('input',()=>{c.value=c.value.replace(/\\D/g,'').slice(0,6);if(c.value.length===6&&!sent){sent=true;f.requestSubmit?f.requestSubmit():f.submit()}});",
  });
}

export function loginNamePage(o: { nonce: string; next: string; value?: string; error?: string }): string {
  return page({
    title: 'Velg navn',
    nonce: o.nonce,
    body: html`<div class="center">
<header class="section">
<span class="label">Første gang</span>
<h1>Velg et visningsnavn</h1>
<p class="muted">Navnet vises på topplista. 2–20 tegn.</p>
</header>
<form class="panel stack" method="post" action="/login/name">
<label class="label" for="name">Visningsnavn</label>
<input id="name" name="name" minlength="2" maxlength="20" required autocomplete="nickname" autofocus value="${o.value ?? ''}">
<input type="hidden" name="next" value="${o.next}">
${err(o.error)}
<button class="btn primary">Ferdig</button>
</form>
</div>`,
  });
}

// ── scan ────────────────────────────────────────────────────────────────────

const SCAN_JS = `${UUID_JS}
const $=i=>document.getElementById(i),states=document.querySelectorAll('[data-state]');
const show=s=>states.forEach(e=>e.hidden=e.dataset.state!==s);
let key=uuid(),lastConfirm=false,lastId=null,timer;
function paint(d){const h=$('count');h.textContent=d.count;$('unit').textContent=d.count===1?'boks':'bokser';$('kr').textContent=d.owe;$('rankline').hidden=!d.rank;if(d.rank)$('rank').textContent=String(d.rank).padStart(2,'0');h.classList.remove('pop');void h.offsetWidth;h.classList.add('pop')}
async function log(confirm){lastConfirm=confirm;show('busy');let r,d={};
try{r=await fetch('/api/cans',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({confirm})});d=await r.json().catch(()=>({}))}catch(e){show('offline');return}
if(r.status===401){location.href='/login?next=%2Fscan';return}
if(r.status===403&&d.error==='name'){location.href='/login/name?next=%2Fscan';return}
if(r.status===409){$('ago').textContent=d.secondsAgo;show('recent');return}
if(r.status===429){$('limitmsg').textContent=d.message;show('limited');return}
if(!r.ok){show('offline');return}
lastId=d.id;$('headline').textContent='✅ 1 Red Bull logget';paint(d);show('ok');
const u=$('undo');u.hidden=false;u.disabled=false;clearTimeout(timer);timer=setTimeout(()=>{u.hidden=true},10000)}
$('undo').onclick=async()=>{const u=$('undo');u.disabled=true;
try{const r=await fetch('/api/cans/'+lastId,{method:'DELETE'});if(r.ok){paint(await r.json());$('headline').textContent='Angret. Ingen boks logget.';u.hidden=true;clearTimeout(timer);return}}catch(e){}
u.disabled=false};
$('more').onclick=()=>{key=uuid();log(true)};
$('yes').onclick=()=>log(true);
$('no').onclick=()=>show('none');
$('retry').onclick=()=>log(lastConfirm);
log(false);`;

export function scanPage(o: { nonce: string }): string {
  return page({
    title: 'Logger Red Bull',
    nonce: o.nonce,
    body: html`<div class="center">
<section data-state="busy">
<span class="label">Logger …</span>
<p class="hero dim">··</p>
</section>
<section data-state="ok" hidden>
<h1 id="headline">✅ 1 Red Bull logget</h1>
<p class="hero" id="count">0</p>
<p class="muted"><span id="unit">bokser</span> denne måneden · du skylder <span class="num" id="kr">0 kr</span></p>
<p class="label" id="rankline">#<span class="peach num" id="rank">01</span> denne måneden</p>
<div class="stack section">
<button class="btn up" id="undo" type="button">Angre</button>
<button class="btn primary" id="more" type="button">+1 til</button>
</div>
</section>
<section data-state="recent" hidden>
<div class="panel stack">
<span class="label">Nettopp logget</span>
<h2>Du logget en for <span class="num" id="ago">0</span> sek siden — logg en til?</h2>
<button class="btn primary" id="yes" type="button">Logg en til</button>
<button class="btn" id="no" type="button">Nei</button>
</div>
</section>
<section data-state="none" hidden>
<span class="label">Ingenting logget</span>
<h1>Greit, ingen ny boks.</h1>
</section>
<section data-state="limited" hidden>
<span class="label">Stopp litt</span>
<h1 id="limitmsg"></h1>
</section>
<section data-state="offline" hidden>
<span class="label">Ingen kontakt</span>
<h1>Fikk ikke logget boksen.</h1>
<p class="muted">Sjekk nettet og prøv igjen.</p>
<button class="btn primary" id="retry" type="button">Prøv igjen</button>
</section>
<noscript><p class="muted">Skru på JavaScript, eller bruk +1-knappen på <a href="/me">Min side</a>.</p></noscript>
<nav class="links section"><a href="/leaderboard">Toppliste</a><a href="/me">Min side</a></nav>
</div>`,
    script: SCAN_JS,
  });
}

// ── me ──────────────────────────────────────────────────────────────────────

const ME_JS = `${UUID_JS}
const $=i=>document.getElementById(i);let key=uuid();
function msg(t){const m=$('msg');m.textContent=t;m.hidden=false}
async function log(confirm){const b=$('plus');b.disabled=true;$('msg').hidden=true;$('recent').hidden=true;
try{const r=await fetch('/api/cans',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({confirm})});const d=await r.json().catch(()=>({}));
if(r.status===401){location.href='/login?next=%2Fme';return}
if(r.ok){location.reload();return}
if(r.status===409){$('ago').textContent=d.secondsAgo;$('recent').hidden=false}else msg(d.message||'Noe gikk galt. Prøv igjen.')}catch(e){msg('Fikk ikke kontakt. Prøv igjen.')}
b.disabled=false}
$('plus').onclick=()=>{key=uuid();log(false)};
$('yes').onclick=()=>log(true);
$('no').onclick=()=>{$('recent').hidden=true};
document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
if(!b.dataset.armed){b.dataset.armed='1';b.textContent='Bekreft';setTimeout(()=>{delete b.dataset.armed;b.textContent='Slett'},3000);return}
b.disabled=true;try{const r=await fetch('/api/cans/'+b.dataset.del,{method:'DELETE'});if(r.ok){location.reload();return}}catch(e){}
b.disabled=false;msg('Kunne ikke slette boksen.')});
function amsg(t){const m=$('avmsg');m.textContent=t;m.hidden=false}
async function decode(file){if(window.createImageBitmap){try{return await createImageBitmap(file)}catch(e){}}
return await new Promise((ok,fail)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=fail;i.src=URL.createObjectURL(file)})}
$('avfile').onchange=async()=>{const file=$('avfile').files[0];if(!file)return;amsg('Laster opp …');
try{const img=await decode(file);const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,s=Math.min(w,h);
const c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d').drawImage(img,(w-s)/2,(h-s)/2,s,s,0,0,256,256);
const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85));
const r=await fetch('/api/avatar',{method:'POST',headers:{'content-type':'image/jpeg'},body:blob});
if(r.ok){location.reload();return}amsg((await r.json().catch(()=>({}))).message||'Kunne ikke laste opp bildet.')}
catch(e){amsg('Kunne ikke lese bildet. Prøv et annet.')}};
const del=$('avdel');if(del)del.onclick=async()=>{
if(!del.dataset.armed){del.dataset.armed='1';del.textContent='Bekreft';setTimeout(()=>{delete del.dataset.armed;del.textContent='Fjern'},3000);return}
try{const r=await fetch('/api/avatar',{method:'DELETE'});if(r.ok){location.reload();return}}catch(e){}amsg('Kunne ikke fjerne bildet.')};`;

type MonthSum = { month: string; count: number; ore: number };

const monthTable = (rows: MonthSum[]) =>
  html`<table><thead><tr><th>Måned</th><th class="r">Bokser</th><th class="r">Beløp</th></tr></thead><tbody>
${rows.map((m) => html`<tr><td class="num">${m.month}</td><td class="num r">${m.count}</td><td class="num r">${formatKr(m.ore)}</td></tr>`)}
</tbody></table>`;

export function mePage(o: {
  nonce: string;
  user: User;
  avatarAt: number | null;
  isAdmin: boolean;
  monthLabel: string;
  stats: CanStats;
  cans: Can[];
  owed: { count: number; ore: number };
  owedMonths: MonthSum[];
  lastPaid: Settlement | undefined;
}): string {
  const { stats, owed } = o;
  const me = { id: o.user.id, name: o.user.display_name, avatarAt: o.avatarAt };
  return page({
    title: 'Min side',
    nonce: o.nonce,
    body: html`<header class="section me-head">
${avatar(me, 'av-lg')}
<div><span class="label">Min side</span><h1 style="margin:0">Hei, ${o.user.display_name}</h1></div>
</header>
<section class="section panel stack">
<span class="label">Denne måneden · ${o.monthLabel}</span>
<p class="hero">${stats.count}</p>
<p class="muted">${bokser(stats.count)} denne måneden${stats.rank ? html` · <span class="num">#${rank2(stats.rank)}</span>` : ''}</p>
<button class="btn primary" id="plus" type="button">+1 Red Bull</button>
<div id="recent" class="stack up" hidden>
<p>Du logget en for <span class="num" id="ago">0</span> sek siden — logg en til?</p>
<div class="row"><button class="btn" id="yes" type="button">Logg en til</button><button class="btn" id="no" type="button">Nei</button></div>
</div>
<p id="msg" class="err small" role="alert" hidden></p>
</section>
<section class="section panel stack">
<span class="label">Utestående</span>
<p class="big" style="margin:0">${formatKr(owed.ore)}</p>
<p class="muted small"><span class="num">${owed.count}</span> ${bokser(owed.count)} ${o.lastPaid ? 'siden du sist betalte' : 'totalt'}</p>
${o.owedMonths.length ? monthTable(o.owedMonths) : ''}
${owed.count ? html`<a class="btn" href="/me/betal">Jeg har betalt</a>` : ''}
${o.lastPaid ? html`<p class="muted small">Sist betalt ${formatDate(o.lastPaid.at)} · <span class="num">${formatKr(o.lastPaid.amount_ore)}</span></p>` : ''}
</section>
<section class="section">
<span class="label">Bokser denne måneden</span>
${o.cans.length
  ? html`<ul class="rows">${o.cans.map(
      (can) => html`<li><span class="num grow">${formatStamp(can.created_at)}${can.created_by_admin ? html` <span class="tag">admin</span>` : ''}</span><span class="num muted">${formatKr(can.price_ore)}</span>${
        can.settlement_id === null
          ? html`<button class="btn sm danger" type="button" data-del="${can.id}">Slett</button>`
          : html`<span class="tag">betalt</span>`
      }</li>`,
    )}</ul>`
  : html`<p class="muted">Ingen ennå denne måneden.</p>`}
</section>
<section class="section">
<span class="label">Profilbilde</span>
<div class="row" style="justify-content:flex-start">
${avatar(me, 'av-lg')}
<label class="btn sm" for="avfile" style="flex:0;white-space:nowrap">${o.avatarAt ? 'Bytt bilde' : 'Velg bilde'}</label>
${o.avatarAt ? html`<button class="btn sm danger" id="avdel" type="button" style="flex:0">Fjern</button>` : ''}
<input id="avfile" type="file" accept="image/*" hidden>
</div>
<p class="muted small" style="margin-top:var(--s2)">Vises på topplista.</p>
<p id="avmsg" class="small" role="status" hidden></p>
</section>
<nav class="links section">
<a href="/leaderboard">Toppliste</a>
${o.isAdmin ? html`<a href="/admin">Admin</a>` : ''}
<form class="inline" method="post" action="/logout"><button type="submit">Logg ut</button></form>
</nav>`,
    script: ME_JS,
  });
}

// ── "Jeg har betalt" ────────────────────────────────────────────────────────

export function payPage(o: {
  nonce: string;
  owed: { count: number; ore: number };
  owedMonths: MonthSum[];
  through: number;
  error?: string;
}): string {
  const kr = formatKr(o.owed.ore);
  const months = o.owedMonths.map((m) => m.month);
  const range = months.length > 1 ? `${months.at(-1)} – ${months[0]}` : (months[0] ?? '');
  return page({
    title: 'Har du betalt?',
    nonce: o.nonce,
    body: html`<div class="center">
<header class="section">
<span class="label">Betaling</span>
<h1>Har du betalt?</h1>
<p class="muted">Når du har betalt, nullstiller du gjelda her. Admin ser fortsatt alt du har kjøpt og betalt.</p>
</header>
${o.owed.count
  ? html`<form class="panel stack" method="post" action="/me/betal">
<span class="label">Utestående</span>
<p class="big" style="margin:0">${kr}</p>
<p class="muted small"><span class="num">${o.owed.count}</span> ${bokser(o.owed.count)} · <span class="num">${range}</span></p>
<input type="hidden" name="through" value="${o.through}">
<input type="hidden" name="amount" value="${o.owed.ore}">
<label class="check"><input type="checkbox" name="confirm" value="ja" required><span>Jeg bekrefter at jeg har betalt <strong class="num">${kr}</strong>.</span></label>
${err(o.error)}
<button class="btn primary">Nullstill gjeld</button>
<a class="btn" href="/me">Avbryt</a>
</form>`
  : html`<div class="panel stack">
<p>Du har ingen utestående gjeld. 🎉</p>
${err(o.error)}
<a class="btn" href="/me">Tilbake</a>
</div>`}
</div>`,
  });
}

export function receiptPage(o: { nonce: string; settlement: Settlement }): string {
  const s = o.settlement;
  return page({
    title: 'Betalt',
    nonce: o.nonce,
    body: html`<div class="center">
<span class="label">Kvittering</span>
<h1>✅ Takk! Gjelda er nullstilt.</h1>
<p class="hero pop">${formatKr(s.amount_ore)}</p>
<p class="muted"><span class="num">${s.cans}</span> ${bokser(s.cans)} · registrert <span class="num">${formatDateTime(s.at)}</span></p>
${s.reversed_at ? html`<p class="err small">Admin har angret denne nullstillingen.</p>` : ''}
<p class="muted small">Bokser du logger fra nå av, havner på en ny regning. Admin ser fortsatt hva du har kjøpt og betalt.</p>
<div class="stack section"><a class="btn primary" href="/me">Tilbake til Min side</a></div>
</div>`,
  });
}

// ── leaderboard ─────────────────────────────────────────────────────────────

export function leaderboardPage(o: {
  nonce: string;
  tab: 'month' | 'total';
  monthLabel: string;
  officeCount: number;
  rows: BoardRow[];
}): string {
  // Competition ranking: ties share a rank, the next rank skips.
  let prev = -1;
  let rank = 0;
  const ranked = o.rows.map((r, i) => {
    if (r.count !== prev) rank = i + 1;
    prev = r.count;
    return { ...r, rank };
  });
  const tab = (id: 'month' | 'total', href: string, label: string): Html =>
    html`<a href="${href}"${o.tab === id ? raw(' aria-current="page"') : ''}>${label}</a>`;
  return page({
    title: 'Toppliste',
    nonce: o.nonce,
    tv: true,
    refreshSec: 60,
    body: html`<header class="section">
<span class="label">Toppliste</span>
<h1>Hvem drikker mest?</h1>
</header>
<section class="section panel">
<span class="label">Kontoret · ${o.monthLabel}</span>
<p class="big" style="margin:0"><span class="num">${o.officeCount}</span> ${bokser(o.officeCount)}</p>
</section>
<section class="section">
<nav class="tabs">${tab('month', '/leaderboard', 'Denne måneden')}${tab('total', '/leaderboard?tab=total', 'Totalt')}</nav>
${ranked.length
  ? html`<ol class="rows" style="margin-top:var(--s4)">${ranked.map(
      (r) => html`<li${r.rank <= 3 ? raw(' class="top"') : ''}><span class="rank num">${rank2(r.rank)}</span>${avatar({ id: r.id, name: r.name, avatarAt: r.avatar_at }, 'av-sm')}<span class="name grow">${r.name}</span><span class="num">${r.count}</span></li>`,
    )}</ol>`
  : html`<p class="muted" style="margin-top:var(--s4)">Ingen bokser logget ennå.</p>`}
</section>
<nav class="links section"><a href="/me">Min side</a></nav>`,
  });
}
