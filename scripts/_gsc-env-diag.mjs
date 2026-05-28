import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });
const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
for (const k of keys) {
  const v = process.env[k] || '';
  console.log(JSON.stringify({
    key: k,
    length: v.length,
    first6: v.slice(0, 6),
    last10: v.slice(-10),
    endsApps: v.endsWith('.apps.googleusercontent.com'),
    startsWith1: v.startsWith('1//'),
    hasDoubleQuote: v.includes('"'),
    hasSingleQuote: v.includes("'"),
    hasSpace: v.includes(' '),
    hasNewline: v.includes('\n') || v.includes('\r'),
  }));
}
