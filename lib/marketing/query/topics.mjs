/**
 * Link topic map (versioned). Turns a clicked link (domain + path, tracking parameters already dropped) into topics so
 * "clicked a Lightroom link" doesn't need a typed URL fragment. A link can carry several topics (a Lake District
 * workshop page is both "workshops" and "away locations"). Product categories are a separate taxonomy: a topic says what
 * the link was about, not what the person bought. Change the rules → bump TOPIC_MAP_VERSION (shown in the builder).
 */
export const TOPIC_MAP_VERSION = 1;

export const TOPICS = [
  { key: 'lightroom', label: 'Lightroom', re: /lightroom/i },
  { key: 'beginners', label: 'Beginners course', re: /beginners/i },
  { key: 'courses', label: 'Courses & classes', re: /course|class|evening/i },
  { key: 'academy', label: 'Academy / free online course', re: /academy|free-online|online-photography-course|exam-page/i },
  { key: 'workshops', label: 'Workshops', re: /workshop|photo-walk|photography-services\/|photo-workshops/i },
  { key: 'away', label: 'Away locations (Lake District, Devon, Wales …)', re: /lake-district|peak-district|devon|dingle|ireland|northumb|snowdonia|anglesey|yorkshire|norfolk|suffolk|exmoor|scotland|dee-valley|fairy-glen|hartland/i },
  { key: 'macro', label: 'Macro, abstract & bracketing', re: /macro|abstract|bracket|stack/i },
  { key: 'woodland', label: 'Woodland & bluebells', re: /woodland|bluebell/i },
  { key: 'long_exposure', label: 'Long exposure & filters', re: /long-exposure|nd-filter|filter/i },
  { key: 'mentoring', label: 'Mentoring, 1-2-1 & RPS', re: /mentor|1-2-1|one-to-one|tutor|private|rps|distinction/i },
  { key: 'vouchers', label: 'Gift vouchers', re: /voucher|gift/i },
  { key: 'pick_n_mix', label: 'Pick n Mix', re: /pick-?n-?mix|pick-and-mix/i },
  { key: 'prints', label: 'Prints', re: /print/i },
  { key: 'blog', label: 'Blog & tips', re: /\/blogs?\/|blog-on-photography|checklist|guide|tips/i },
  { key: 'social', label: 'Social media', re: /facebook\.com|instagram\.com|linkedin\.com/i },
  { key: 'homepage', label: 'Home page / view in browser', re: /^alanranger\.com\/?$|VIEW_IN_BROWSER/i }
];

export function topicsOf(url) {
  const u = String(url || '');
  return TOPICS.filter((t) => t.re.test(u)).map((t) => t.key);
}

/** Campaign ids are stored shortened in customer facts (12 trailing hex characters are unique across the archive). */
export const shortId = (id) => String(id || '').slice(-12);

export const topicLabel = (key) => TOPICS.find((t) => t.key === key)?.label || key;
