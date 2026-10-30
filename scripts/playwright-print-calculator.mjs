/**
 * Click every calculator button on the local spaced copy and assert a result.
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const html = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'Photo & Print Size Calculator',
  'index.html'
);
const fileUrl = pathToFileURL(html).href;

const tabs = [
  {
    tab: 'original-calculator',
    fill: { 'original-width': '6000', 'original-height': '4000' },
    click: 'original-calculate',
    result: 'original-result'
  },
  {
    tab: 'pixel-to-physical',
    fill: { 'pixel-width': '6000', 'pixel-height': '4000' },
    click: 'calculate-pixel-to-physical',
    result: 'pixel-to-physical-result-content'
  },
  {
    tab: 'physical-to-pixel',
    fill: { 'physical-width': '10', 'physical-height': '8' },
    click: 'calculate-physical-to-pixel',
    result: 'physical-to-pixel-result-content'
  },
  {
    tab: 'print-quality',
    fill: { 'image-width': '6000', 'image-height': '4000', 'print-width': '10', 'print-height': '8' },
    click: 'calculate-print-quality',
    result: 'print-quality-result-content'
  },
  {
    tab: 'aspect-ratio-finder',
    fill: { 'ratio-width': '6000', 'ratio-height': '4000' },
    click: 'calculate-aspect-ratio',
    result: 'aspect-ratio-result-content'
  }
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true }));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err?.message || err)));
await page.goto(fileUrl);
for (const step of tabs) {
  await page.click(`.tab-trigger[data-tab="${step.tab}"]`);
  for (const [id, value] of Object.entries(step.fill)) {
    await page.fill(`#${id}`, value);
  }
  await page.click(`#${step.click}`);
  const text = await page.locator(`#${step.result}`).innerText();
  if (!String(text || '').trim()) {
    await browser.close();
    throw new Error(`empty result for ${step.click}`);
  }
  console.log(`ok ${step.click}: ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
}
await browser.close();
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
console.log('all calculator buttons produced a result');
