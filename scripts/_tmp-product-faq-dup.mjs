import { chromium } from 'playwright';

async function inspect(url) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  const data = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    return scripts.map((el, i) => {
      let json = null;
      try { json = JSON.parse((el.textContent || '').trim()); } catch (e) {}
      const nodes = json && Array.isArray(json['@graph']) ? json['@graph'] : (json ? [json] : []);
      const types = nodes.map((n) => n && n['@type']);
      const faqs = nodes.filter((n) => {
        const t = n && n['@type'];
        return t === 'FAQPage' || (Array.isArray(t) && t.includes('FAQPage'));
      });
      return {
        i,
        id: el.id || '',
        types,
        faqCount: faqs.length,
        faqId: faqs[0] && faqs[0]['@id'],
        faqQs: faqs[0] && (Array.isArray(faqs[0].mainEntity) ? faqs[0].mainEntity.length : (faqs[0].mainEntity ? 1 : 0))
      };
    });
  });
  await browser.close();
  return data;
}

const urls = [
  'https://www.alanranger.com/photography-services-near-me/beginners-photography-course',
  'https://www.alanranger.com/photography-services-near-me/rps-mentoring-photography-course',
  'https://www.alanranger.com/photography-services-near-me/lightroom-courses-for-beginners'
];
for (const url of urls) {
  const data = await inspect(url);
  console.log('\n==', url);
  console.log(JSON.stringify(data, null, 2));
}
