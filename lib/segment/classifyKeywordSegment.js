/**
 * Keyword Segment Classifier
 * 
 * Classifies keywords into segments based on intent (Brand → Money → Education → Other)
 * Priority order: Brand (highest) → Money → Education → Other
 * 
 * @param {Object} params
 * @param {string} params.keyword - The keyword to classify
 * @param {string|null} params.pageType - Optional page type (weak hint only)
 * @param {string|null} params.rankingUrl - Optional ranking URL (weak hint only)
 * @returns {Object} { segment: string, confidence: number, reason: string }
 */

const SEGMENTS = {
  BRAND: 'brand',
  MONEY: 'money',
  EDUCATION: 'education',
  OTHER: 'other'
};

/**
 * Brand terms (case-insensitive matching)
 */
const BRAND_TERMS = [
  'alan ranger',
  'alanranger',
  'alan ranger photography',
  'photography academy',
  'alan ranger academy'
];

/**
 * Money terms (transactional/service intent)
 */
const MONEY_TERMS = [
  'lesson',
  'lessons',
  'class',
  'classes',
  'course',
  'courses',
  'training',
  'workshop',
  'workshops',
  'mentoring',
  'mentor',
  '1-2-1',
  '1:1',
  'private',
  'hire',
  'service',
  'services',
  'photographer',
  'booking',
  'book',
  'price',
  'cost',
  'voucher',
  'gift'
];

/**
 * Local modifiers (UK localities - expand as needed)
 */
const LOCAL_MODIFIERS = [
  'near me',
  'in coventry',
  'coventry',
  'birmingham',
  'warwick',
  'leamington',
  'solihull',
  'rugby'
];

/**
 * Education terms (informational/learning intent)
 */
const EDUCATION_TERMS = [
  'how to',
  'what is',
  'guide',
  'tutorial',
  'tips',
  'settings',
  'meaning',
  'vs',
  'difference',
  'examples',
  'best way to'
];

/**
 * Technique/topic terms (photography-specific educational content)
 */
const TECHNIQUE_TOPICS = [
  'aperture',
  'shutter speed',
  'iso',
  'depth of field',
  'histogram',
  'dynamic range',
  'composition'
];

/**
 * Check if keyword contains any of the given terms (case-insensitive)
 */
function containsTerm(keyword, terms) {
  const lowerKeyword = keyword.toLowerCase();
  return terms.some(term => lowerKeyword.includes(term.toLowerCase()));
}

/**
 * Check if keyword matches a postcode-like pattern
 */
function hasPostcodePattern(keyword) {
  // UK postcode patterns: e.g., "CV1", "B1 1AA", "CV1 1AA"
  const postcodePattern = /\b([A-Z]{1,2}\d{1,2}\s?\d?[A-Z]{0,2})\b/i;
  return postcodePattern.test(keyword);
}

/**
 * Main classifier function
 */
export function classifyKeywordSegment({ keyword, pageType = null, rankingUrl = null }) {
  if (!keyword || typeof keyword !== 'string') {
    return {
      segment: SEGMENTS.OTHER,
      confidence: 0,
      reason: 'Invalid or missing keyword'
    };
  }

  const normalizedKeyword = keyword.trim().toLowerCase();

  // Priority 1: Brand (highest priority)
  if (containsTerm(normalizedKeyword, BRAND_TERMS)) {
    const matchedTerm = BRAND_TERMS.find(term => normalizedKeyword.includes(term.toLowerCase()));
    return {
      segment: SEGMENTS.BRAND,
      confidence: 0.95,
      reason: `brand: contains '${matchedTerm}'`
    };
  }

  // Priority 2: Money (transactional OR local intent)
  const hasMoneyTerm = containsTerm(normalizedKeyword, MONEY_TERMS);
  const hasLocalModifier = containsTerm(normalizedKeyword, LOCAL_MODIFIERS);
  const hasPostcode = hasPostcodePattern(normalizedKeyword);

  if (hasMoneyTerm || hasLocalModifier || hasPostcode) {
    let reason = 'money: ';
    if (hasMoneyTerm) {
      const matchedTerm = MONEY_TERMS.find(term => normalizedKeyword.includes(term.toLowerCase()));
      reason += `contains '${matchedTerm}'`;
    } else if (hasLocalModifier) {
      const matchedTerm = LOCAL_MODIFIERS.find(term => normalizedKeyword.includes(term.toLowerCase()));
      reason += `contains local modifier '${matchedTerm}'`;
    } else {
      reason += 'contains postcode pattern';
    }
    
    // Boost confidence if pageType is GBP (weak hint)
    let confidence = 0.85;
    if (pageType === 'GBP') {
      confidence = 0.9;
      reason += ' + GBP page type';
    }
    
    return {
      segment: SEGMENTS.MONEY,
      confidence,
      reason
    };
  }

  // Priority 3: Education (informational/learning intent)
  const hasEducationTerm = containsTerm(normalizedKeyword, EDUCATION_TERMS);
  const hasTechniqueTopic = containsTerm(normalizedKeyword, TECHNIQUE_TOPICS);
  
  // Check if it's technique/topic oriented WITHOUT transactional/local signals
  // (already checked for money terms above, so if we get here, it's not transactional)
  if (hasEducationTerm || hasTechniqueTopic) {
    let reason = 'education: ';
    if (hasEducationTerm) {
      const matchedTerm = EDUCATION_TERMS.find(term => normalizedKeyword.includes(term.toLowerCase()));
      reason += `contains '${matchedTerm}'`;
    } else {
      const matchedTerm = TECHNIQUE_TOPICS.find(term => normalizedKeyword.includes(term.toLowerCase()));
      reason += `contains technique/topic '${matchedTerm}'`;
    }
    
    // Boost confidence if pageType is Blog (weak hint)
    let confidence = 0.8;
    if (pageType === 'Blog') {
      confidence = 0.85;
      reason += ' + Blog page type';
    }
    
    return {
      segment: SEGMENTS.EDUCATION,
      confidence,
      reason
    };
  }

  // Priority 4: Other (fallback)
  return {
    segment: SEGMENTS.OTHER,
    confidence: 0.5,
    reason: 'other: no matching intent signals'
  };
}

export { SEGMENTS };

