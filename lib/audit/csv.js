const parseCsvLine = (line) => {
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
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((v) => v.trim());
};

const extractUrlsFromCsv = (csvText) => {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const urlIdx = headers.findIndex((h) => h.includes('url') || h.includes('page'));
  if (urlIdx === -1) return [];

  const urls = [];
  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const url = fields[urlIdx];
    if (url && typeof url === 'string') {
      const trimmed = url.trim();
      if (trimmed) urls.push(trimmed);
    }
  }
  return urls;
};

const fetchSiteUrlsCsv = async (primaryUrl, fallbackUrl, fetchFn = fetch) => {
  const urls = [];
  let primaryError = null;

  if (primaryUrl) {
    try {
      const response = await fetchFn(primaryUrl);
      if (!response.ok) {
        throw new Error(`Primary CSV fetch failed: ${response.status}`);
      }
      const csvText = await response.text();
      urls.push(...extractUrlsFromCsv(csvText));
      if (urls.length > 0) return urls;
    } catch (err) {
      primaryError = err;
    }
  }

  if (fallbackUrl) {
    const response = await fetchFn(fallbackUrl);
    if (!response.ok) {
      throw primaryError || new Error(`Fallback CSV fetch failed: ${response.status}`);
    }
    const csvText = await response.text();
    urls.push(...extractUrlsFromCsv(csvText));
  }

  return urls;
};

export { fetchSiteUrlsCsv };
