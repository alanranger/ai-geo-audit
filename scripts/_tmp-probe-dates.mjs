import xlsx from 'xlsx';

function serial(n) {
  const d = xlsx.SSF.parse_date_code(n);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}
console.log('45712', serial(45712), '45954', serial(45954), '45964', serial(45964));
const b = await (await fetch('https://www.alanranger.com/beginners-photography-lessons?format=json')).json();
const week1 = [...(b.upcoming || []), ...(b.past || [])].filter(
  (i) => /beginner/i.test(i.title) && /week\s*1/i.test(i.title)
);
console.log('week1 count', week1.length);
for (const it of week1.slice(0, 20)) {
  console.log(new Date(it.startDate).toISOString().slice(0, 10), it.title.slice(0, 70));
}
