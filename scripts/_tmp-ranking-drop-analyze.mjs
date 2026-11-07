import fs from 'fs';

const j = JSON.parse(fs.readFileSync('C:/Users/alan/Documents/Codex/2026-09-28/when/outputs/ranking-drop-investigation.json', 'utf8'));
const ev = JSON.parse(fs.readFileSync('C:/Users/alan/Documents/Codex/2026-09-28/when/outputs/ranking-drop-mover-evidence.json', 'utf8'));

console.log('=== weekly ===');
console.log(JSON.stringify(j.weekly.map((w) => ({
  date: w.date, ranked: w.ranked, unranked: w.unranked, top10: w.top10, avg: w.avg_group, coord: w.with_coord, devices: w.devices, depths: w.depths
})), null, 2));

console.log('=== wow ===');
console.log(JSON.stringify(j.wow.map((w) => ({
  span: `${w.old_date}->${w.new_date}`, lost: w.lost, declined: w.declined_ge5, gained: w.gained, improved: w.improved_ge5,
  ranked: `${w.old.ranked}->${w.new.ranked}`, top10: `${w.old.top10}->${w.new.top10}`, avg: `${w.old.avg_group}->${w.new.avg_group}`
})), null, 2));

console.log('=== locShift ===');
console.log(JSON.stringify(j.locShift, null, 2));

console.log('=== top lost ===');
console.log(JSON.stringify(j.long_aug31_to_sep28.top_lost.slice(0, 20), null, 2));

console.log('=== top declined ===');
console.log(JSON.stringify(j.long_aug31_to_sep28.top_declined.slice(0, 15), null, 2));

const patterns = [];
for (const [kw, pack] of Object.entries(ev)) {
  patterns.push({
    kw,
    a31: pack.aug31?.best_rank_group ?? null,
    s21: pack.sep21?.best_rank_group ?? null,
    s28: pack.sep28?.best_rank_group ?? null,
    a31_coord: !!pack.aug31?.location_coordinate,
    s21_coord: !!pack.sep21?.location_coordinate,
    s28_coord: !!pack.sep28?.location_coordinate,
    a31_loc: pack.aug31?.location_name,
    s21_device: pack.sep21?.device,
    s28_device: pack.sep28?.device,
    s21_depth: pack.sep21?.serp_depth,
    s28_depth: pack.sep28?.serp_depth,
    s28_err: pack.sep28?.error || null,
    class: pack.aug31?.keyword_class || pack.sep28?.keyword_class,
    s21_url: (pack.sep21?.best_url || '').split('?')[0] || null,
    s28_url: (pack.sep28?.best_url || '').split('?')[0] || null
  });
}
console.log('=== evidence patterns ===');
console.log(JSON.stringify(patterns, null, 2));

// Split lost by when they disappeared: present Sep14, gone Sep21 vs present Sep21 gone Sep28
const trajectories = j.trajectories || [];
console.log('=== trajectory count', trajectories.length);
for (const t of trajectories.slice(0, 12)) {
  const line = t.points.map((p) => `${p.date.slice(5)}:${p.group ?? 'X'}${p.coord ? '*' : ''}`).join(' ');
  console.log(t.keyword, '=>', line);
}
