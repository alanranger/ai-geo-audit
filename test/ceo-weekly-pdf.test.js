import test from 'node:test';
import assert from 'node:assert/strict';
import { ceoWeeklyPdfFilename } from '../lib/ceo-weekly/html-to-pdf.js';

test('ceoWeeklyPdfFilename uses week start date', () => {
  assert.equal(ceoWeeklyPdfFilename('2026-10-05'), 'CEO-weekly-health-2026-10-05.pdf');
});
