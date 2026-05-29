/** Client-side column sort for Revenue Truth tables (click header → sort + indicator). */

function cellSortValue(td) {
  if (!td) return '';
  if (td.querySelector('.rt-inline-spark, svg.rt-inline-spark')) return null;
  const text = (td.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text || text === '—' || text === '-') return '';
  const stripped = text.replace(/[£%+]/g, '').replace(/,/g, '');
  const num = Number(stripped);
  if (!Number.isNaN(num) && /[\d]/.test(text)) return num;
  return text.toLowerCase();
}

function compareValues(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en-GB', { numeric: true });
}

function setSortIndicators(table, activeTh, dir) {
  table.querySelectorAll('thead th').forEach((h) => {
    h.classList.toggle('is-sorted', h === activeTh);
    const ind = h.querySelector('.rt-sort-ind');
    if (!ind) return;
    if (h === activeTh) ind.textContent = dir === 'asc' ? '↑' : '↓';
    else ind.textContent = '↕';
  });
}

function sortableRows(tbody) {
  return [...tbody.rows].filter((r) => !r.classList.contains('rt-glance-section') && !r.querySelector('td[colspan]'));
}

function sortTableByColumn(table, colIdx, th) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const dir = th.dataset.rtSortDir === 'asc' ? 'desc' : 'asc';
  table.querySelectorAll('thead th').forEach((h) => { if (h !== th) delete h.dataset.rtSortDir; });
  th.dataset.rtSortDir = dir;
  const rows = sortableRows(tbody);
  rows.sort((a, b) => {
    const cmp = compareValues(cellSortValue(a.cells[colIdx]), cellSortValue(b.cells[colIdx]));
    return dir === 'asc' ? cmp : -cmp;
  });
  rows.forEach((r) => tbody.appendChild(r));
  setSortIndicators(table, th, dir);
}

export function bindRtTableSorting(root) {
  if (!root) return;
  root.querySelectorAll('table:not(.rt-opp-table)').forEach((table) => {
    table.querySelectorAll('thead th').forEach((th, colIdx) => {
      if (th.dataset.rtSortBound === '1') return;
      th.dataset.rtSortBound = '1';
      th.classList.add('rt-sortable');
      if (!th.querySelector('.rt-sort-ind')) {
        th.insertAdjacentHTML('beforeend', ' <span class="rt-sort-ind" aria-hidden="true">↕</span>');
      }
      th.addEventListener('click', () => sortTableByColumn(table, colIdx, th));
    });
  });
}
