/**
 * One-shot: add llm_prompt column, flag signed 14, add best photography workshops uk,
 * rewrite mirrors via writeLockedConfigFiles.
 */
import { writeLockedConfigFiles, loadExistingLockedByKeyword } from '../lib/keyword-ranking/locked-config-persist.js';
import { censusFromByKeyword, normalizeTrackingKey } from '../lib/keyword-ranking/locked-config-merge.js';

const SIGNED_14 = [
  'photography courses coventry',
  'beginners photography courses coventry',
  'online photography course',
  'free online photography course',
  'private photography tuition',
  'hire a photographer coventry',
  'commercial photographer coventry',
  'photography workshops uk',
  'landscape photography workshops uk',
  'macro photography workshops',
  'photography holidays uk',
  'photo editing course',
  'photography mentoring',
  'photography gift vouchers',
];

const byKeyword = loadExistingLockedByKeyword();
const missing = [];
for (const kw of SIGNED_14) {
  const key = normalizeTrackingKey(kw);
  if (!byKeyword[key]) missing.push(kw);
}
if (missing.length) {
  console.error('MISSING from tracked set:', missing);
  process.exit(1);
}

for (const row of Object.values(byKeyword)) {
  row.llm_prompt = false;
}
for (const kw of SIGNED_14) {
  byKeyword[normalizeTrackingKey(kw)].llm_prompt = true;
}

const addKey = normalizeTrackingKey('best photography workshops uk');
if (!byKeyword[addKey]) {
  byKeyword[addKey] = {
    keyword: 'best photography workshops uk',
    tracking_location: 'UK',
    location_name_dfs: 'United Kingdom',
    keyword_class: 'national-money',
    target_page: '/photography-workshops',
    llm_prompt: false,
  };
  console.log('ADDED best photography workshops uk');
} else {
  console.log('best photography workshops uk already present');
}

const census = censusFromByKeyword(byKeyword);
const flagged = Object.values(byKeyword).filter((r) => r.llm_prompt).map((r) => r.keyword).sort();
console.log('census', census);
console.log('flagged', flagged.length, flagged);

const written = writeLockedConfigFiles(byKeyword, 'v4');
console.log('wrote', written);
