import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { HOST, loadConfig, PORT } from './config';
import { openDb, seed } from './db';
import { consoleMailer, resendMailer } from './mailer';

const config = loadConfig();

if (config.mailMode === 'console' && !config.publicUrl.startsWith('http://localhost')) {
  throw new Error('MAIL_MODE=console is only allowed with a http://localhost PUBLIC_URL');
}
if (config.mailMode === 'resend' && !config.resendApiKey) {
  console.warn('RESEND_API_KEY is not set: login codes cannot be sent');
}

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
seed(db, config, Date.now());

const mailer = config.mailMode === 'console' ? consoleMailer : resendMailer({ apiKey: config.resendApiKey, from: config.mailFrom });
const app = createApp({ db, mailer, config });

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`redbull-tally listening on http://${info.address}:${info.port} for ${config.publicUrl}`);
});

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
