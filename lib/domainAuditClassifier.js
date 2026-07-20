/**
 * One-time / recurring audit classifier for consistent money-keyword rivals.
 * HIGH conf → auto-apply; MED conf competitor-like sites → queue for is_competitor approval.
 */
import { normalizeDomain } from './domainStrength/domains.js';

export const AUDIT_SOURCE = 'auto-audit-2026-07-16';

const PLATFORM = new Set([
  'youtube.com', 'reddit.com', 'facebook.com', 'instagram.com', 'pinterest.com',
  'skillshare.com', 'udemy.com', 'domestika.org', 'coursera.org', 'classcentral.com',
  'learningwithexperts.com', 'groupon.com', 'groupon.co.uk', 'eventbrite.com', 'eventbrite.co.uk',
  'virginexperiencedays.co.uk', 'virginexperiencedays.com', 'trackdays.co.uk', 'trackdays.com',
  'classbento.com', 'classbento.co.uk', 'lightroom.adobe.com', 'adobe.com',
  'upwork.com', 'fiverr.com', 'airtasker.com',
]);

const DIRECTORY = new Set([
  'bark.com', 'superprof.co.uk', 'tutorful.co.uk', 'findtutors.co.uk', 'findcourses.co.uk',
  'freelancerclub.co.uk', 'creativepool.com', 'uniquelylocal.co.uk', 'splento.com',
  'perfocal.com', 'snappr.com', 'poptop.co.uk', 'bookanartist.co.uk', 'hitched.co.uk',
  'wedissimo.co.uk', 'uk.indeed.com', 'indeed.com', 'thumbtack.com',
  'visualeducation.com', 'trustpilot.com', 'yell.com', 'yelp.com',
]);

const VENDOR = new Set([
  'etsy.com', 'cewe.co.uk', 'cewe.com', 'blurb.com', 'snappysnaps.co.uk', 'maxphoto.co.uk',
  'wilkinson.co.uk', 'zno.com', 'pixpa.com', 'format.com', 'progradedigital.com',
  'fujifilm-houseofphotography.co.uk', 'pangolinphoto.com', 'photobox.co.uk', 'photobox.com',
  'amazon.co.uk', 'amazon.com', 'ebay.com',
]);

function listMatch(domain, set) {
  if (set.has(domain)) return true;
  for (const root of set) {
    if (domain.endsWith('.' + root)) return true;
  }
  return false;
}

function tldType(domain) {
  if (/\.gov(\.|$)/i.test(domain) || /\.gov\.uk$/i.test(domain)) {
    return { domain_type: 'government', confidence: 'HIGH', reason: 'tld:gov.uk' };
  }
  if (/\.ac\.uk$/i.test(domain) || /\.edu(\.|$)/i.test(domain)) {
    return { domain_type: 'institution', confidence: 'HIGH', reason: 'tld:ac.uk/edu' };
  }
  return null;
}

/** Photography-school / single-brand competitor heuristic (MED — queue is_competitor). */
function looksLikeIndependentSchool(domain) {
  const d = domain.toLowerCase();
  const tokens = /(photo|photograph|camera|dslr|course|training|academy|school|workshop|master)/;
  if (!tokens.test(d)) return false;
  const noise = /(stock|news|blog|forum|wiki|shop|store|print|lab|gear|review|compare|find|near|best|top)/;
  return !noise.test(d);
}

/**
 * @returns {{ domain_type: string, confidence: 'HIGH'|'MED'|'LOW', reason: string, action: string, propose_is_competitor?: boolean }}
 */
export function auditClassifyDomain(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return { domain_type: 'unmapped', confidence: 'LOW', reason: 'invalid domain', action: 'skip' };
  }

  if (listMatch(domain, PLATFORM)) {
    return { domain_type: 'platform', confidence: 'HIGH', reason: 'audit:known-platform', action: 'auto_apply' };
  }
  if (listMatch(domain, DIRECTORY)) {
    return { domain_type: 'directory', confidence: 'HIGH', reason: 'audit:known-directory', action: 'auto_apply' };
  }
  if (listMatch(domain, VENDOR)) {
    return { domain_type: 'vendor', confidence: 'HIGH', reason: 'audit:known-vendor', action: 'auto_apply' };
  }

  const tld = tldType(domain);
  if (tld) return { ...tld, action: 'auto_apply' };

  if (looksLikeIndependentSchool(domain)) {
    return {
      domain_type: 'site',
      confidence: 'MED',
      reason: 'audit:photography-school-heuristic',
      action: 'queue_competitor',
      propose_is_competitor: true,
    };
  }

  return {
    domain_type: 'unmapped',
    confidence: 'LOW',
    reason: 'audit:ambiguous',
    action: 'queue_review',
  };
}

export function passesRealCompetitorFilter(domainType, isCompetitor, realOnly, domainTypeSource) {
  if (!realOnly) return true;
  if (isCompetitor) return true;
  const type = domainType || 'unmapped';
  if (type === 'unmapped') return false;
  if (domainTypeSource === 'fallback') return false;
  const noise = new Set(['platform', 'directory', 'government', 'institution', 'publisher', 'vendor']);
  if (noise.has(type)) return false;
  return type === 'site';
}
