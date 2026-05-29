/** Live click-test for Opportunity Stack on production. */
import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html#revenue-truth';
const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForOpp(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#rt-opportunity-stack-body .rt-opp-table', { timeout: 180000 });
  await page.waitForFunction(() => {
    const diag = document.getElementById('rt-diag-tier-list');
    return diag && !/Loading diagnosis/i.test(diag.textContent || '');
  }, { timeout: 180000 });
}

async function midTotal(page) {
  return page.locator('.rt-opp-total-val-mid').first().textContent();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await waitForOpp(page);

    const allMid = (await midTotal(page))?.trim();
    await page.click('[data-rt-opp-filter="group_a"]');
    await page.waitForTimeout(300);
    const groupAMid = (await midTotal(page))?.trim();
    if (groupAMid && groupAMid !== allMid) pass('Filter recomputes totals', `${allMid} → ${groupAMid}`);
    else fail('Filter recomputes totals', `all=${allMid} groupA=${groupAMid}`);

    await page.click('[data-rt-opp-filter="all"]');
    await page.waitForTimeout(200);

    const midTh = page.locator('[data-rt-opp-sort="mid"]').first();
    const indBefore = await midTh.locator('.rt-opp-sort-ind').textContent();
    await midTh.click();
    await page.waitForTimeout(200);
    const indAfter1 = await midTh.locator('.rt-opp-sort-ind').textContent();
    await midTh.click();
    await page.waitForTimeout(200);
    const indAfter2 = await midTh.locator('.rt-opp-sort-ind').textContent();
    if (indBefore !== indAfter1 && indAfter1 !== indAfter2) pass('Column sort asc/desc toggle', `${indBefore} → ${indAfter1} → ${indAfter2}`);
    else fail('Column sort asc/desc toggle', `${indBefore} / ${indAfter1} / ${indAfter2}`);

    const dupSort = await page.locator('.rt-opp-table thead th .rt-sort-ind').count();
    if (dupSort === 0) pass('Single sort indicator per column', 'no rt-sort-ind duplicates');
    else fail('Single sort indicator per column', `${dupSort} duplicate rt-sort-ind found`);

    const detail1 = page.locator('[data-rt-opp-detail="row_1"]');
    if (await detail1.evaluate((el) => el.classList.contains('is-collapsed'))) pass('Chevron starts collapsed');
    else fail('Chevron starts collapsed');

    await page.click('[data-rt-opp-chevron="row_1"]');
    await page.waitForTimeout(200);
    if (!(await detail1.evaluate((el) => el.classList.contains('is-collapsed')))) pass('Chevron expands on click');
    else fail('Chevron expands on click');

    await page.click('.rt-opp-row[data-tier-anchor="one_to_one_lessons"]');
    await page.waitForTimeout(1200);
    const tierRow = page.locator('#rt-diag-tier-one_to_one_lessons');
    const inView = await tierRow.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    }).catch(() => false);
    const expanded = await tierRow.evaluate((el) => el && !el.classList.contains('is-collapsed')).catch(() => false);
    if (inView || expanded) pass('Row click scrolls to §9 tier', 'one_to_one_lessons visible/expanded');
    else fail('Row click scrolls to §9 tier', 'tier row not in view');
  } catch (err) {
    fail('Unexpected error', err.message);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
