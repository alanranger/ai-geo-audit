/**
 * Domain Type Classifier - Aggressive tiered matching (8 types)
 * 
 * Classifies domains into: your_site, platform, directory, publisher, vendor, institution, government, site
 * Uses tiered matching (A-D) to achieve 80%+ coverage
 */

import { normalizeDomain } from './domainStrength/domains.js';

// Tier A: Exact/seed mappings (confidence 0.95)
const YOUR_SITE_DOMAINS = new Set([
  'alanranger.com'
]);

const PLATFORM_DOMAINS = new Set([
  'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'x.com', 'twitter.com', 'linkedin.com', 'reddit.com', 'pinterest.com',
  'github.com', 'stackoverflow.com', 'medium.com', 'wordpress.com', 'blogspot.com',
  'quora.com', 'wikipedia.org', 'flickr.com', 'vimeo.com', 'dailymotion.com',
  'twitch.tv', 'discord.com', 'slack.com', 'telegram.org', 'whatsapp.com',
  'snapchat.com', 'tumblr.com', 'myspace.com', 'digg.com', 'stumbleupon.com',
  // Course / experience aggregators (Competitor Analysis noise fix 2026-07-16)
  'skillshare.com', 'udemy.com', 'coursera.org', 'alison.com', 'edx.org',
  'futurelearn.com', 'masterclass.com', 'domestika.org', 'classcentral.com',
  'learningwithexperts.com', 'eventbrite.com', 'eventbrite.co.uk', 'groupon.com',
  'groupon.co.uk', 'notonthehighstreet.com', 'virginexperiencedays.co.uk',
  'virginexperiencedays.com', 'classbento.com', 'classbento.co.uk', 'airbnb.com',
  'meetup.com', 'adobe.com', 'lightroom.adobe.com', 'photoshop.com',
  'trackdays.co.uk', 'trackdays.com', 'upwork.com', 'fiverr.com', 'airtasker.com',
  'creativelive.com', 'allevents.in', 'buyagift.co.uk',
]);

const DIRECTORY_DOMAINS = new Set([
  'trustpilot.com', 'yell.com', 'yelp.com', 'bark.com', 'tripadvisor.com',
  'foursquare.com', 'hotfrog.com', 'cylex.co.uk', 'thomsonlocal.com', 'freeindex.co.uk',
  'findtutors.co.uk', 'superprof.co.uk', 'tutorful.co.uk', 'amazingtalker.co.uk',
  'visualeducation.com', 'findcourses.co.uk', 'freelancerclub.co.uk', 'creativepool.com',
  'uniquelylocal.co.uk', 'uniquelylocal.com', 'splento.com', 'perfocal.com', 'snappr.com',
  'poptop.co.uk', 'bookanartist.co.uk', 'bookanartist.co', 'hitched.co.uk', 'wedissimo.co.uk',
  'uk.indeed.com', 'indeed.com', 'thumbtack.com', 'houzz.co.uk', 'houzz.com',
  'photographerforhire.co.uk', 'manchesterservicedirectory.co.uk',
]);

const PUBLISHER_DOMAINS = new Set([
  'bbc.com', 'bbc.co.uk', 'theguardian.com', 'telegraph.co.uk', 'times.co.uk',
  'reuters.com', 'apnews.com', 'cnn.com', 'nytimes.com', 'washingtonpost.com',
  'independent.co.uk', 'dailymail.co.uk', 'mirror.co.uk', 'sun.co.uk',
  'petapixel.com', 'photographylife.com', 'digital-photography-school.com',
  'talkphotography.co.uk', 'timeout.com',
]);

const VENDOR_DOMAINS = new Set([
  'amazon.com', 'amazon.co.uk', 'ebay.com', 'etsy.com', 'shopify.com',
  'magento.com', 'woocommerce.com', 'bigcommerce.com', 'squarespace.com',
  'cewe.co.uk', 'cewe.com', 'blurb.com', 'snappysnaps.co.uk', 'maxphoto.co.uk',
  'wilkinson.co.uk', 'zno.com', 'pixpa.com', 'format.com', 'progradedigital.com',
  'fujifilm-houseofphotography.co.uk', 'fujifilm-houseofphotography.com',
  'pangolinphoto.com', 'photobox.co.uk', 'photobox.com', 'cameraworld.co.uk',
  'kenro.co.uk', 'canon.co.uk', 'nikon.co.uk', 'nikonschool.co.uk', 'online.nikonschool.com',
]);

const INSTITUTION_EXTRA = new Set([
  'city-academy.com', 'nyip.edu', 'theknowledgeacademy.com', 'field-studies-council.org',
]);

// Tier B: TLD/SLD patterns (confidence 0.90)
function matchesTLDPattern(domain) {
  // Government patterns
  if (/\.gov(\.|$)/i.test(domain) || /\.gov\.uk$/i.test(domain) || /\.gouv\./i.test(domain)) {
    return { domain_type: 'government', confidence: 90, reason: 'tld:gov' };
  }
  
  // Institution patterns
  if (/\.ac\.uk$/i.test(domain) || /\.edu(\.|$)/i.test(domain) || /\.sch\.uk$/i.test(domain)) {
    return { domain_type: 'institution', confidence: 90, reason: 'tld:ac.uk/edu' };
  }
  
  // NHS/Police (UK government)
  if (/\.nhs\.uk$/i.test(domain) || /\.police\.uk$/i.test(domain)) {
    return { domain_type: 'government', confidence: 90, reason: 'tld:nhs.uk/police.uk' };
  }
  
  return null;
}

// Tier C: Keyword/token heuristics (confidence 0.60-0.75)
function matchesKeywordPattern(domain) {
  const lower = domain.toLowerCase();
  
  // Directory keywords
  const directoryPattern = /(review|reviews|directory|listing|listings|rated|compare|top|best|find|near|search|local|guide|index)/i;
  if (directoryPattern.test(lower)) {
    return { domain_type: 'directory', confidence: 70, reason: 'token:directory-keyword' };
  }
  
  // Publisher keywords
  const publisherPattern = /(news|journal|mag|press|daily|times|guardian|telegraph|bbc|apnews|reuters|article|blog|media|publication)/i;
  if (publisherPattern.test(lower)) {
    return { domain_type: 'publisher', confidence: 65, reason: 'token:publisher-keyword' };
  }
  
  // Vendor keywords
  const vendorPattern = /(shop|store|software|app|cloud|saas|pricing|buy|download|market|sale|cart|checkout|payment)/i;
  if (vendorPattern.test(lower)) {
    return { domain_type: 'vendor', confidence: 60, reason: 'token:vendor-keyword' };
  }
  
  return null;
}

/**
 * Suggest domain type using tiered matching
 * 
 * @param {string} rawDomain - Raw domain input
 * @returns {Object|null} - { domain_type, confidence, reason, source } or null if parse fails
 */
function listMatch(domain, set) {
  if (set.has(domain)) return true;
  // Subdomains of known platforms/vendors (e.g. lightroom.adobe.com)
  for (const root of set) {
    if (domain.endsWith('.' + root)) return true;
  }
  return false;
}

export function suggestDomainType(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return null;
  
  // Tier A: Exact/seed mappings (confidence 0.95)
  const primaryDomain = normalizeDomain(process.env.AI_GEO_DOMAIN || process.env.SITE_DOMAIN || 'alanranger.com');
  if (domain === primaryDomain) {
    return { 
      domain_type: 'your_site', 
      confidence: 95, 
      reason: 'exact:your_site',
      source: 'seed'
    };
  }
  
  if (listMatch(domain, PLATFORM_DOMAINS)) {
    return { 
      domain_type: 'platform', 
      confidence: 95, 
      reason: `known:${domain}`,
      source: 'list'
    };
  }
  
  if (listMatch(domain, DIRECTORY_DOMAINS)) {
    return { 
      domain_type: 'directory', 
      confidence: 95, 
      reason: `known:${domain}`,
      source: 'list'
    };
  }
  
  if (listMatch(domain, PUBLISHER_DOMAINS)) {
    return { 
      domain_type: 'publisher', 
      confidence: 95, 
      reason: `known:${domain}`,
      source: 'list'
    };
  }
  
  if (listMatch(domain, VENDOR_DOMAINS)) {
    return { 
      domain_type: 'vendor', 
      confidence: 95, 
      reason: `known:${domain}`,
      source: 'list'
    };
  }

  if (listMatch(domain, INSTITUTION_EXTRA)) {
    return {
      domain_type: 'institution',
      confidence: 95,
      reason: `known:${domain}`,
      source: 'list',
    };
  }
  
  // Tier B: TLD/SLD patterns (confidence 0.90)
  const tldMatch = matchesTLDPattern(domain);
  if (tldMatch) {
    return { ...tldMatch, source: 'tld' };
  }
  
  // Tier C: Keyword/token heuristics (confidence 0.60-0.75)
  const keywordMatch = matchesKeywordPattern(domain);
  if (keywordMatch) {
    return { ...keywordMatch, source: 'heuristic' };
  }
  
  // Tier D: Fallback — unmapped until audit/classifier confirms (prevents noise leak)
  return {
    domain_type: 'unmapped',
    confidence: 35,
    reason: 'fallback:unmapped',
    source: 'fallback',
  };
}

/**
 * Ensure domain type mapping exists in database
 * Never overwrites manual classifications
 * 
 * @param {Object} supabase - Supabase client
 * @param {string} rawDomain - Raw domain input
 * @param {string} sourceTag - Source identifier (e.g., 'history-miss', 'autofill-script')
 * @returns {Promise<Object>} - { status, reason, domain_type? }
 */
export async function ensureDomainTypeMapping(supabase, rawDomain, sourceTag) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { status: 'skipped', reason: 'invalid domain' };
  
  const suggestion = suggestDomainType(domain);
  if (!suggestion) {
    return { status: 'skipped', reason: 'parse failed' };
  }
  
  try {
    // Check existing row
    const { data: existing, error: fetchError } = await supabase
      .from('domain_strength_domains')
      .select('domain_type, domain_type_source')
      .eq('domain', domain)
      .limit(1)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows found (expected for new domains)
      console.error(`[ensureDomainTypeMapping] Error fetching existing mapping for ${domain}:`, fetchError);
      return { status: 'error', reason: fetchError.message };
    }
    
    // Never overwrite manual classifications
    if (existing && existing.domain_type_source === 'manual') {
      return { status: 'skipped', reason: 'manual override exists' };
    }
    
    const payload = {
      domain,
      updated_at: new Date().toISOString(),
      label: existing?.label || domain, // Preserve existing label
    };
    
    let action = 'skipped';
    let reason = 'no change needed';
    
    // Determine if we should write
    const shouldWrite = !existing || 
                        existing.domain_type === null || 
                        existing.domain_type === 'unmapped' ||
                        existing.domain_type_source === 'auto' ||
                        existing.domain_type_source === 'seed' ||
                        existing.domain_type_source === 'tld' ||
                        existing.domain_type_source === 'heuristic' ||
                        existing.domain_type_source === 'fallback';
    
    if (shouldWrite) {
      payload.domain_type = suggestion.domain_type;
      payload.domain_type_source = suggestion.source || sourceTag || 'auto';
      payload.domain_type_confidence = suggestion.confidence;
      payload.domain_type_reason = suggestion.reason;
      
      // Set segment for backward compatibility (use domain_type)
      payload.segment = suggestion.domain_type;
      
      const { error: upsertError } = await supabase
        .from('domain_strength_domains')
        .upsert(payload, { onConflict: 'domain' });
      
      if (upsertError) {
        console.error(`[ensureDomainTypeMapping] Error upserting mapping for ${domain}:`, upsertError);
        return { status: 'error', reason: upsertError.message };
      }
      
      action = existing ? 'updated' : 'inserted';
      reason = `${suggestion.source || 'auto'}:${suggestion.domain_type}`;
    } else {
      reason = 'existing non-auto mapping';
    }
    
    return { 
      status: action, 
      reason, 
      domain_type: suggestion.domain_type,
      confidence: suggestion.confidence
    };
    
  } catch (e) {
    console.error(`[ensureDomainTypeMapping] Unexpected error for ${domain}:`, e);
    return { status: 'error', reason: e.message };
  }
}

