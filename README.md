# Red Bull tally

> Showcase copy of a private project. Hostnames, emails and the deployment target are replaced with example values, and the original build spec and printed sign are left out.

Coworkers take a Red Bull from the office fridge and scan the QR code taped to it. That logs one can to their tab with no taps. Everyone can see what they owe this month. A public leaderboard shows who drinks the most.

- Live: https://tally.example.com
  - `/scan`: what the QR code opens; logs a can
  - `/me`: your month, history, +1 button, undo
  - `/leaderboard`: public, auto-refreshes every 60 s (good on an office TV)
  - `/admin`: admin only; everyone else gets 404

## Architecture

```
phone ──https──▶ Cloudflare ──tunnel──▶ cloudflared on the Pi ──▶ 127.0.0.1:8095
                                                                    node dist/server.js
                                                                    (Hono + node:sqlite)
                                                                         │
                                                       ~/redbull-tally/data/tally.db (WAL)
```

- **Runtime:** Node 24 in `~/.local/node` on the Raspberry Pi (`ssh mypi`). It runs as the `systemctl --user` service `redbull-tally`, which keeps running without a login because linger is on.
- **Code:** TypeScript, [Hono](https://hono.dev) and `@hono/node-server`. SQLite through Node's built-in `node:sqlite`, so there are no native modules. esbuild bundles it into one `dist/server.js` (plus `dist/cli.js`).
- **Pages:** server-rendered HTML with a little inline JS. No framework, CDN or web fonts. Every page is under 30 KB, and a test checks this. The design follows `.claude/skills/pure-design/SKILL.md`.
- **Login:** the person enters their email and gets a 6-digit code through Resend. They type the code in, and get a random session token in an `HttpOnly; Secure; SameSite=Lax` cookie for 400 days, renewed on every visit. The database stores only hashes of codes and tokens. Only emails in `members` ever get a code, and everyone sees the same response.
- **Abuse limits:**
  - 5 codes per email per hour (sends Resend refuses don't count)
  - 10 code requests per IP per hour
  - at most 80 emails in any 24 hours, under Resend Free's 100 per day
  - 5 cans per person per 10 minutes
  - a "you just logged one, log another?" check within 60 s
  - every POST and DELETE must carry `Origin: PUBLIC_URL`
- **Money:** stored as integer øre. Each can keeps the price it was logged at. Months are Oslo calendar months.
- **Source map:**
  - `src/app.ts`: middleware: headers, CSRF, sessions
  - `src/routes/*`: pages and API
  - `src/auth.ts`, `src/cans.ts`: rules
  - `src/store.ts`: SQL
  - `src/views/*`: HTML and CSS
  - `src/cli.ts`: members and backup

Nothing here costs money. It uses the Pi, the existing Cloudflare Tunnel and Resend Free.

## Onboarding a coworker

1. Add their email to the members list (see below).
2. They scan the QR code on the fridge, type their email, then type the code from the email. The code is in the subject line, «Red Bull-koden din: 123456», so it can be read straight from the notification. On iPhone the code field can autofill it from Mail.
3. The first time, they pick a display name. That's it. From then on, each scan logs a can with no taps, for about a year.

**New phone or cleared browser:** they log in again with the same email and land on their existing account.

**Home-screen app (iPhone):** in Safari, open `/me` → Share → *Add to Home Screen*. iOS gives a home-screen web app its own cookies, separate from Safari, so it needs its own one-time login. QR scans always open in Safari and use Safari's login. The home-screen app starts on `/me`, never `/scan`, so opening it doesn't log a can.

## Adding members

The allowlist is the `members` table. The admin email (`admin@example.com`) is always on it.

**Whole list from a file** (one email per line, `#` comments allowed). Run this from the Mac:

```sh
npm run members -- emails.txt
```

This copies the file to the Pi and runs `node ~/redbull-tally/dist/cli.js members <file>`. That replaces the allowlist and deactivates and logs out anyone no longer on it; their history is kept. If any line isn't a valid email, nothing changes. `emails.txt` is git-ignored.

**One at a time, or a pasted list:** use `/admin/members`. Removing an email there also deactivates that user and ends their sessions. Re-adding an email doesn't reactivate the user; do that in `/admin/users`.

## Changing the price

Go to `/admin` → *Pris per boks*, and type for example `10` or `12,50`. It applies to new cans only; existing cans keep their price.

## Debt, paying and "Jeg har betalt"

Debt is a running total: every can adds to it until the person says they've paid, for example at the end of the semester.
- On **Min side** everyone sees what they owe in total and per month since they last paid.
- When they've paid, they tap **Jeg har betalt**. They must tick "Jeg bekrefter at jeg har betalt X kr" and confirm, then they get a receipt. The paid months disappear from their own view, and new cans start a new total.
- A can logged while the confirmation page is open is not cleared by accident, and cans that are already paid can't be undone.
- **`/admin/payments`** shows, per person, what they've bought, what they've cleared and what they still owe, and lists every clearing. **Angre** on a clearing makes that amount owed again, for when someone tapped it without paying.
- The month overview and CSV still count every can, paid or not.

## Profile pictures

Everyone can add a picture on Min side (*Velg bilde*). The phone crops it square and shrinks it to 256 px before uploading, and the server accepts only JPEG, PNG or WebP up to 200 KB. Pictures show on Min side and the public leaderboard; people without one get their initials. Remove a picture in `/admin/users` (*Fjern bilde*). A deactivated user's picture is no longer served.

## Collecting money

Go to `/admin/month`, pick a month and see each person's count and amount. *Eksporter CSV* downloads a semicolon-separated file that opens directly in Norwegian Excel. There is no "paid" tracking.

## Admin

The account whose email is `admin@example.com` is the admin. It logs in the normal way, at `/login?next=/admin`. You can:
- set the price
- see the monthly overview and CSV
- add and remove members
- rename, deactivate, reactivate or log out users
- list, delete, restore and add cans: forgotten scans are flagged `admin` and can be backdated
- see email usage against the Resend limits

Every admin action is written to `admin_log`, which you can see at `/admin/log`.

## Deploying

```sh
npm run deploy
```

This runs the tests and the typecheck, then bundles. It then:
1. installs Node 24 in `~/.local/node` on the Pi, if it isn't there yet
2. copies `RESEND_API_KEY`, and only that value, from `~/redbull-secrets.env` to `~/redbull-tally/.env` (`chmod 600`), if that file doesn't exist yet
3. rsyncs `dist/` and the systemd units
4. restarts the service
5. checks `http://127.0.0.1:8095/healthz` on the Pi

On the Pi it only writes to `~/redbull-tally/`, `~/.local/node/` and `~/.config/systemd/user/redbull-tally*`. It never uses sudo. If port 8095 is held by anything other than this service, it stops.

Other services may share the Pi. Before and after anything bigger, snapshot it read-only:

```sh
bash scripts/pi-snapshot.sh > ops/pi-before.txt
# … deploy …
bash scripts/pi-snapshot.sh > ops/pi-after.txt
diff ops/pi-before.txt ops/pi-after.txt   # only redbull-tally units and :8095 may differ
```

**Logs:** `ssh mypi journalctl --user-unit=redbull-tally.service -f` (plain `journalctl --user` shows nothing on this Pi; user-unit logs live in the system journal). Login codes are never logged.

**Sending domain:** codes are sent from `redbull@mail.example.com`. That subdomain is verified in Resend through 3 DNS records in Cloudflare (`resend._domainkey.mail`, `rsend.mail`, `send.mail`) plus `_dmarc`. Recipients can be on any domain.

**Rotating the Resend key:** delete `~/redbull-tally/.env` on the Pi, update `~/redbull-secrets.env`, then run `npm run deploy`.

## Backups and restoring

The `redbull-tally-backup.timer` user timer runs every night around 03:30. It makes an online SQLite backup to `~/redbull-tally/backups/tally-YYYY-MM-DD.db` and keeps 30 days. To run one now:

```sh
ssh mypi 'systemctl --user start redbull-tally-backup.service && ls -l ~/redbull-tally/backups'
```

To restore:

```sh
ssh mypi
systemctl --user stop redbull-tally                 # closes the DB and checkpoints the WAL
cd ~/redbull-tally/data
mkdir -p ../restore-safety && cp tally.db* ../restore-safety/
rm -f tally.db-wal tally.db-shm
cp ../backups/tally-2026-10-05.db tally.db
systemctl --user start redbull-tally
curl -s http://127.0.0.1:8095/healthz
```

To copy a backup to the Mac: `rsync mypi:redbull-tally/backups/ ./backups/` (git-ignored).

## Local development

You need Node 24.

```sh
npm install
npm test          # tsc + Vitest (in-memory SQLite, Resend mocked)
npm run dev       # http://localhost:8095; login codes are printed to the terminal
npm run sign      # regenerate print/qr-scan.png and print/sign.html
```

`npm run dev` uses `MAIL_MODE=console`. It refuses to start that way unless `PUBLIC_URL` is `http://localhost…`.

## The fridge sign

`print/sign.html` is an A6 page that reads «Tok du en Red Bull? Skann meg 📱». It has the QR code for `/scan` and is generated locally with the `qrcode` npm package. Open it in a browser and print it at 100 % on A6, or on A4 and cut it out. `print/qr-scan.png` is the same code as a 1200 px PNG.
