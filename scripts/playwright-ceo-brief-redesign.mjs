// Playwright proof for the Monday brief redesign (batch 8 task 15 / 15h):
//  1. every section, tile and card present; no retired block;
//  2. full-page screenshots of the preview and the mockup at 600 px and 375 px, side by side in one PNG.
//   node scripts/playwright-ceo-brief-redesign.mjs --preview <file.html> --mockup <file.html> --png <out.png>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const previewFile = arg('preview');
const mockupFile = arg('mockup');
const pngOut = arg('png');

const REQUIRED = [
  'HEADLINES', 'GP, 3-month average', 'Sales year to date', 'People per event, next 90 days', 'Bookings per 1,000 search visits',
  'Academy, ', 'Google clicks to booking pages', 'Visits from AI assistants', 'AI answers naming you',
  'A · WHERE YOU STAND', 'B · WHAT CHANGED SINCE LAST MONDAY', "C · THIS WEEK'S ACTIONS",
  '1 · Operations', "PIPELINE · WHAT'S BOOKED AHEAD", 'Push these 3 this week',
  '2 · Revenue & GP', 'THIS MONTH & YEAR TO DATE · YOUR TARGETS', 'Money signals', 'The Academy',
  '3 · Strategy', 'Fill rate', 'Run rate', 'Profit levers scorecard',
  '4 · SEO & AI visibility', 'The website', 'Ranking changes', 'The AI front', 'Backlinks & authority', 'SEO health',
  '5 · System health', 'Figures checked before sending'
];
const RETIRED = [
  'EXECUTIVE SUMMARY', 'BIGGEST WINS', 'BIGGEST WORRIES', 'DO THIS WEEK', 'DEEPER ANALYSIS', 'Upcoming events',
  'Batsford: AM and PM sessions', 'no sales in 14 days', 'STRATEGY · WHERE YOU STAND', 'Traditional SEO: ',
  'A · The website', 'B · The money', 'C · The AI front', 'D · The Academy', 'G · Profit levers', 'E · Ranking changes',
  'F · SEO health', 'MOCKUP v7'
];

async function shoot(page, file, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`file:///${path.resolve(file).replace(/\\/g, '/')}`);
  return page.screenshot({ fullPage: true, type: 'png' });
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file:///${path.resolve(previewFile).replace(/\\/g, '/')}`);
const bodyText = await page.evaluate(() => document.body.innerText);
const tiles = await page.evaluate(() => [...document.querySelectorAll('td[width="25%"] > div[style*="height:132px"]')].length);
const missing = REQUIRED.filter((s) => !bodyText.includes(s));
const retired = RETIRED.filter((s) => bodyText.includes(s));
const order = ['HEADLINES', '1 · Operations', '2 · Revenue & GP', '3 · Strategy', '4 · SEO & AI visibility', '5 · System health'].map((s) => bodyText.indexOf(s));
const inOrder = order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
console.log(JSON.stringify({ tiles, missing, retired_present: retired, sections_in_order: inOrder }, null, 1));

const shots = [];
for (const width of [600, 375]) {
  shots.push({ label: `Mockup v7 · ${width}px`, b64: (await shoot(page, mockupFile, width)).toString('base64'), width });
  shots.push({ label: `Preview 2 Nov · ${width}px`, b64: (await shoot(page, previewFile, width)).toString('base64'), width });
}
const board = `<html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff;font-family:Arial"><table cellspacing="16"><tr>${shots.map((s) => `<td style="vertical-align:top"><div style="font-size:18px;font-weight:700;margin:0 0 8px">${s.label}</div><img src="data:image/png;base64,${s.b64}" style="width:${s.width}px;border:1px solid #ccc"></td>`).join('')}</tr></table></body></html>`;
const boardFile = path.join(path.dirname(path.resolve(pngOut)), 'tmp-ceo-board.html');
fs.writeFileSync(boardFile, board);
await page.setViewportSize({ width: 2100, height: 900 });
await page.goto(`file:///${boardFile.replace(/\\/g, '/')}`);
await page.screenshot({ path: pngOut, fullPage: true });
fs.unlinkSync(boardFile);
await browser.close();
const ok = tiles === 8 && !missing.length && !retired.length && inOrder;
console.log(`${ok ? 'PASS' : 'FAIL'} · screenshot ${pngOut}`);
process.exitCode = ok ? 0 : 1;
