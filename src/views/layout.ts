import { html, raw, type Html } from './html';
import { STYLE } from './style';

export type PageOpts = {
  title: string;
  body: Html;
  nonce: string;
  /** Inline script, run after the body. */
  script?: string;
  wide?: boolean;
  /** Leaderboard: larger type and two columns on wide screens. */
  tv?: boolean;
  refreshSec?: number;
};

export function page(o: PageOpts): string {
  const doc = html`<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0b0c">
<meta name="robots" content="noindex,nofollow">
${o.refreshSec ? raw(`<meta http-equiv="refresh" content="${o.refreshSec}">\n`) : ''}<title>${o.title}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Red Bull">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<style>${raw(STYLE)}</style>
</head>
<body${o.tv ? raw(' class="tv"') : ''}>
<main class="wrap${o.wide ? ' wide' : ''}">
${o.body}
</main>
${o.script ? html`<script nonce="${o.nonce}">${raw(o.script)}</script>` : ''}
</body>
</html>
`;
  return doc.__html;
}

export function messagePage(nonce: string, label: string, title: string, text: string): string {
  return page({
    title,
    nonce,
    body: html`<div class="center">
<span class="label">${label}</span>
<h1>${title}</h1>
<p class="muted">${text}</p>
<nav class="links"><a href="/me">Min side</a><a href="/leaderboard">Toppliste</a></nav>
</div>`,
  });
}

export const notFoundPage = (nonce: string) =>
  messagePage(nonce, '404', 'Fant ikke siden', 'Lenken er feil, eller siden finnes ikke.');

export const errorPage = (nonce: string) =>
  messagePage(nonce, 'Feil', 'Noe gikk galt', 'Prøv igjen om litt.');
