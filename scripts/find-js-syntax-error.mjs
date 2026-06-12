import fs from 'fs';
import vm from 'vm';

const html = fs.readFileSync('G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/audit-dashboard.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
let i = 0;
for (const m of scripts) {
  i += 1;
  const code = m[1];
  if (code.trim().length < 500) continue;
  try {
    new vm.Script(code, { filename: `inline-script-${i}.js` });
  } catch (e) {
    console.log('FAIL script', i, e.message);
    const m2 = String(e.stack || e.message).match(/inline-script-\d+\.js:(\d+)/);
    const line = m2 ? Number(m2[1]) : 0;
    const lines = code.split('\n');
    console.log('around line', line);
    console.log(lines.slice(Math.max(0, line - 8), line + 5).map((l, idx) => `${Math.max(0, line - 8) + idx + 1}|${l}`).join('\n'));
    break;
  }
}
