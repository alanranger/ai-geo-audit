export const config = { runtime: 'nodejs' };

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = ['disavow-alanranger-com.txt', 'Disavow links https_www_alanranger_com.txt'];

function readDisavowText() {
  const roots = [process.cwd(), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')];
  for (let r = 0; r < roots.length; r += 1) {
    for (let n = 0; n < NAMES.length; n += 1) {
      const p = path.join(roots[r], 'public', NAMES[n]);
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).setHeader('Content-Type', 'text/plain; charset=utf-8').send('Method not allowed');
    return;
  }
  const t = readDisavowText();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!t) {
    res.status(404).send('');
    return;
  }
  res.status(200).send(t);
}
