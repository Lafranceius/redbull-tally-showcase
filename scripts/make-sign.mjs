// npm run sign: QR code + printable A6 sign for the fridge, generated locally (no online generators).
import { mkdirSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const base = (process.env.PUBLIC_URL ?? 'https://tally.example.com').replace(/\/+$/, '');
const url = `${base}/scan`;
const ink = '#0b0b0c';
const opts = { errorCorrectionLevel: 'M', margin: 4, color: { dark: ink, light: '#ffffff' } };

mkdirSync('print', { recursive: true });
await QRCode.toFile('print/qr-scan.png', url, { ...opts, width: 1200 });
const svg = await QRCode.toString(url, { ...opts, type: 'svg' });

const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<title>Skilt til kjøleskapet</title>
<style>
@page { size: A6 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { color: ${ink}; background: #fff; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.sheet {
  width: 105mm; height: 148mm; padding: 10mm 9mm 8mm;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center;
}
.label { font: 500 8.5pt/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; color: #6e6961; }
h1 { margin: 4mm 0 0; font-size: 21pt; line-height: 1.15; font-weight: 700; letter-spacing: -.01em; }
.qr svg { display: block; width: 74mm; height: 74mm; }
.rule { width: 18mm; height: 1.2mm; margin: 0 auto 3mm; background: #ff9b76; }
.how { margin: 0 0 2mm; font-size: 9pt; line-height: 1.35; color: #3a3a40; }
.url { margin: 0; font: 500 7pt/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #6e6961; word-break: break-all; }
@media screen {
  body { background: #e9e5dd; }
  .sheet { margin: 12mm auto; background: #fff; box-shadow: 0 0 0 1px #d6d1c7; }
}
</style>
</head>
<body>
<div class="sheet">
  <div>
    <span class="label">Kjøleskapet</span>
    <h1>Tok du en Red Bull? Skann meg 📱</h1>
  </div>
  <div class="qr">${svg}</div>
  <div>
    <div class="rule"></div>
    <p class="how">Pek kameraet på koden. Første gang logger du inn med jobb-e-posten din, etter det går det av seg selv.</p>
    <p class="url">${url}</p>
  </div>
</div>
</body>
</html>
`;
writeFileSync('print/sign.html', html);
console.log(`print/qr-scan.png and print/sign.html → ${url}`);
