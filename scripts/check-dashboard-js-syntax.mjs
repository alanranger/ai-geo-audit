/**
 * Extract <script> blocks from audit-dashboard.html and syntax-check with node --check.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const html = readFileSync('audit-dashboard.html', 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
let n = 0;
let failed = 0;
const dir = mkdtempSync(join(tmpdir(), 'dash-js-'));
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/i.test(attrs)) continue;
  const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  if (type && !/javascript|ecmascript|^$/i.test(type) && type !== 'module') continue;
  const body = m[2];
  if (!body.trim()) continue;
  n += 1;
  const file = join(dir, `block-${n}.js`);
  writeFileSync(file, body);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    const err = (r.stderr || r.stdout || '').split(/\n/).slice(0, 8).join('\n');
    // map to approximate HTML line
    const idx = m.index;
    const line = html.slice(0, idx).split(/\n/).length;
    console.error(`FAIL script #${n} near html line ${line}:\n${err}`);
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ scriptsChecked: n, failed }));
process.exit(failed ? 1 : 0);
