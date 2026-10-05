/**
 * Render CEO weekly HTML email to a PDF buffer (A4, print backgrounds).
 * Production (Vercel): @sparticuz/chromium + puppeteer-core.
 * Local dev: Playwright Chromium if installed.
 */

export function ceoWeeklyPdfFilename(weekStart) {
  const d = String(weekStart || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `CEO-weekly-health-${d}.pdf`;
}

async function pdfFromPage(page, html) {
  await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
  await page.emulateMedia({ media: 'print' });
  const buf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
  });
  return Buffer.from(buf);
}

async function renderWithSparticuz(html) {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = await import('puppeteer-core');
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 794, height: 1123 },
    executablePath,
    headless: true
  });
  try {
    const page = await browser.newPage();
    return await pdfFromPage(page, html);
  } finally {
    await browser.close();
  }
}

async function renderWithPlaywright(html) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await pdfFromPage(page, html);
  } finally {
    await browser.close();
  }
}

/** @returns {Promise<Buffer|null>} */
export async function renderCeoWeeklyPdf(html) {
  if (!html || String(process.env.CEO_WEEKLY_SKIP_PDF || '').toLowerCase() === 'true') {
    return null;
  }
  const onVercel = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION);
  if (onVercel) return renderWithSparticuz(html);
  try {
    return await renderWithPlaywright(html);
  } catch (e) {
    console.warn('[CEO PDF] local Playwright failed, trying Sparticuz path:', e?.message || e);
    return renderWithSparticuz(html);
  }
}
