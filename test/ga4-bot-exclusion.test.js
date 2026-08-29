import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEventRows,
  parsePageEventRows,
  parseTotalsByGroup,
  ga4AttributedView,
  GA4_UNATTRIBUTED_GROUP
} from '../api/aigeo/ga4-data.js';
import { conversionHealthFromMetrics } from '../lib/revenue-funnel-conversion-bias.js';

const row = (dims, metrics) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: [].concat(metrics).map((value) => ({ value: String(value) }))
});

test('parseEventRows splits raw vs bot-excluded event counts', () => {
  const out = parseEventRows({
    rows: [
      row(['form_start', 'Organic Search'], 500),
      row(['form_start', GA4_UNATTRIBUTED_GROUP], 9),
      row(['page_view', 'Direct'], 20011),
      row(['page_view', GA4_UNATTRIBUTED_GROUP], 43519)
    ]
  });
  assert.equal(out.all.form_start, 509);
  assert.equal(out.attributed.form_start, 500);
  assert.equal(out.all.page_view, 63530);
  assert.equal(out.attributed.page_view, 20011);
});

test('parseTotalsByGroup excludes the automated group from attributed totals', () => {
  const out = parseTotalsByGroup({
    rows: [
      row(['Organic Search'], [10000, 13000]),
      row(['Direct'], [5762, 7011]),
      row([GA4_UNATTRIBUTED_GROUP], [43407, 43519])
    ]
  });
  assert.equal(out.sessions, 59169);
  assert.equal(out.attributedSessions, 15762);
  assert.equal(out.pageViews, 63530);
  assert.equal(out.attributedPageViews, 20011);
});

test('parsePageEventRows tracks money-page enquiries with and without bots', () => {
  const out = parsePageEventRows({
    rows: [
      row(['/photography-tuition-services', 'form_start', 'Organic Search'], 100),
      row(['/photography-tuition-services', 'form_start', GA4_UNATTRIBUTED_GROUP], 10),
      row(['/blog/something', 'view_item', 'Organic Search'], 40),
      row(['/blog/something', 'scroll', 'Organic Search'], 999)
    ]
  });
  assert.equal(out.site, 150, 'non-enquiry events are ignored');
  assert.equal(out.siteAttributed, 140);
  assert.equal(out.money, 110);
  assert.equal(out.moneyAttributed, 100);
});

test('ga4AttributedView prefers bot-excluded columns and reports what was removed', () => {
  const view = ga4AttributedView({
    sessions_28d: 59169,
    page_views_28d: 63530,
    enquiry_events_28d: 999,
    money_page_enquiry_events_28d: 144,
    attributed_sessions_28d: 15762,
    attributed_page_views_28d: 20011,
    attributed_enquiry_events_28d: 915,
    attributed_money_page_enquiry_events_28d: 132,
    unattributed_sessions_28d: 43407,
    unattributed_page_views_28d: 43519,
    unattributed_enquiry_events_28d: 84,
    event_counts: { page_view: 63530 },
    event_counts_attributed: { page_view: 20011 }
  });
  assert.equal(view.bot_excluded, true);
  assert.equal(view.sessions, 15762);
  assert.equal(view.excluded_sessions, 43407);
  assert.equal(view.money_page_enquiry_events, 132);
  assert.equal(view.raw_sessions, 59169, 'raw stays available for auditability');
  assert.equal(view.event_counts.page_view, 20011);
});

test('ga4AttributedView falls back to raw for pre-split snapshots and says so', () => {
  const view = ga4AttributedView({
    sessions_28d: 40405,
    page_views_28d: 44355,
    enquiry_events_28d: 810,
    money_page_enquiry_events_28d: 144,
    event_counts: { page_view: 44355 }
  });
  assert.equal(view.bot_excluded, false);
  assert.equal(view.sessions, 40405);
  assert.equal(view.excluded_sessions, 0);
  assert.equal(view.event_counts.page_view, 44355);
});

test('ga4AttributedView returns null with no snapshot', () => {
  assert.equal(ga4AttributedView(null), null);
});

test('conversionHealthFromMetrics accepts an attributed view', () => {
  const health = conversionHealthFromMetrics(
    { money_page_enquiry_events: 132, enquiry_events: 915 },
    { transactions: 16 }
  );
  assert.equal(health.money_page_enquiry_events_28d, 132);
  assert.equal(health.site_enquiry_events_28d, 915);
  assert.ok(Math.abs(health.enquiry_to_sale_pct - 12.12) < 0.05);
});

test('conversionHealthFromMetrics still accepts a raw snapshot row', () => {
  const health = conversionHealthFromMetrics(
    { money_page_enquiry_events_28d: 144, enquiry_events_28d: 810 },
    { transactions: 16 }
  );
  assert.equal(health.money_page_enquiry_events_28d, 144);
  assert.ok(Math.abs(health.enquiry_to_sale_pct - 11.11) < 0.05);
});
