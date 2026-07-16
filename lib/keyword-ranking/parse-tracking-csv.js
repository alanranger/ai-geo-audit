const FULL_HEADER = ['keyword', 'tracking_location', 'location_name_dfs', 'class', 'target_page'];

export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function isFullHeader(fields) {
  if (!fields.length) return false;
  const norm = fields.map((f) => String(f || '').trim().toLowerCase());
  return norm[0] === 'keyword'
    && (norm.includes('class') || norm.includes('tracking_location'));
}

function rowFromFullFields(fields) {
  const keyword = String(fields[0] || '').trim();
  if (!keyword) return null;
  return {
    keyword,
    tracking_location: String(fields[1] || '').trim(),
    location_name_dfs: String(fields[2] || '').trim(),
    class: String(fields[3] || '').trim(),
    target_page: String(fields[4] || '').trim(),
  };
}

export function detectAndParseTrackingCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (!lines.length) return { format: 'bare', rows: [] };

  const firstFields = parseCsvLine(lines[0]);
  if (isFullHeader(firstFields)) {
    const rows = lines.slice(1)
      .map(parseCsvLine)
      .map(rowFromFullFields)
      .filter(Boolean);
    return { format: 'full', rows };
  }

  const rows = [];
  const start = firstFields.length === 1
    && firstFields[0].toLowerCase() === 'keyword' ? 1 : 0;
  for (let i = start; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const keyword = String(fields[0] || '').trim();
    if (keyword) rows.push({ keyword });
  }
  return { format: 'bare', rows };
}

export function rowToCsvLine(row) {
  const loc = row.location_name_dfs || '';
  const locField = loc.includes(',') ? `"${loc}"` : loc;
  return [
    row.keyword,
    row.tracking_location || '',
    locField,
    row.keyword_class || row.class || '',
    row.target_page || '',
  ].join(',');
}
