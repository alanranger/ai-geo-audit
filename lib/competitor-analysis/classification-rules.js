/**
 * HIGH-confidence domain type seeds for Competitor Analysis audit (2026-07-16).
 * Used by classifier + one-time audit script. Manual rows are never overwritten.
 */

export const AUDIT_SOURCE = 'auto-audit-2026-07-16';

export const HIGH_PLATFORM = Object.freeze([
  'youtube.com', 'reddit.com', 'facebook.com', 'instagram.com', 'pinterest.com',
  'skillshare.com', 'udemy.com', 'domestika.org', 'coursera.org', 'classcentral.com',
  'learningwithexperts.com', 'groupon.com', 'groupon.co.uk', 'eventbrite.com',
  'eventbrite.co.uk', 'virginexperiencedays.co.uk', 'virginexperiencedays.com',
  'trackdays.co.uk', 'classbento.com', 'classbento.co.uk', 'lightroom.adobe.com',
  'adobe.com', 'upwork.com', 'fiverr.com', 'airtasker.com', 'creativelive.com',
  'alison.com', 'edx.org', 'futurelearn.com', 'masterclass.com', 'meetup.com',
  'airbnb.com', 'allevents.in', 'buyagift.co.uk', 'notonthehighstreet.com',
]);

export const HIGH_DIRECTORY = Object.freeze([
  'bark.com', 'superprof.co.uk', 'tutorful.co.uk', 'findtutors.co.uk',
  'findcourses.co.uk', 'freelancerclub.net', 'creativepool.com', 'uniquelylocal.com',
  'splento.com', 'perfocal.com', 'snappr.com', 'poptop.com', 'bookanartist.co',
  'hitched.co.uk', 'wedissimo.com', 'uk.indeed.com', 'indeed.com', 'houzz.co.uk',
  'houzz.com', 'visualeducation.com', 'photographerforhire.co.uk',
  'manchesterservicedirectory.co.uk', 'yell.com', 'yelp.com', 'trustpilot.com',
]);

export const HIGH_VENDOR = Object.freeze([
  'etsy.com', 'cewe.co.uk', 'cewe.com', 'blurb.com', 'snappysnaps.co.uk',
  'maxphoto.co.uk', 'wilkinson.co.uk', 'zno.com', 'pixpa.com', 'format.com',
  'progradedigital.com', 'fujifilm-houseofphotography.com', 'pangolinphoto.com',
  'cameraworld.co.uk', 'kenro.co.uk', 'canon.co.uk', 'nikon.co.uk',
  'nikonschool.co.uk', 'online.nikonschool.com', 'photobox.co.uk', 'photobox.com',
  'amazon.co.uk', 'amazon.com', 'squarespace.com',
]);

export const HIGH_PUBLISHER = Object.freeze([
  'petapixel.com', 'photographylife.com', 'digital-photography-school.com',
  'talkphotography.co.uk', 'timeout.com', 'nytimes.com',
]);

export const HIGH_INSTITUTION = Object.freeze([
  'city-academy.com', 'nyip.edu', 'theknowledgeacademy.com', 'morleycollege.ac.uk',
  'field-studies-council.org',
]);

/** Name/token hints for MED-conf independent photography businesses (queue only). */
const MED_SITE_HINT = /(photo|camera|dslr|workshop|course|academy|school|studio|training|lens)/i;

export function highTypeForDomain(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return null;
  const match = (list) => list.some((root) => d === root || d.endsWith('.' + root));
  if (/\.gov\.uk$/i.test(d) || /\.gov$/i.test(d)) {
    return { domain_type: 'government', confidence: 95, reason: 'audit:high:tld-gov' };
  }
  if (/\.ac\.uk$/i.test(d) || /\.edu$/i.test(d) || match(HIGH_INSTITUTION)) {
    return { domain_type: 'institution', confidence: 95, reason: 'audit:high:institution' };
  }
  if (match(HIGH_PLATFORM)) {
    return { domain_type: 'platform', confidence: 95, reason: 'audit:high:platform' };
  }
  if (match(HIGH_DIRECTORY)) {
    return { domain_type: 'directory', confidence: 95, reason: 'audit:high:directory' };
  }
  if (match(HIGH_VENDOR)) {
    return { domain_type: 'vendor', confidence: 95, reason: 'audit:high:vendor' };
  }
  if (match(HIGH_PUBLISHER)) {
    return { domain_type: 'publisher', confidence: 95, reason: 'audit:high:publisher' };
  }
  return null;
}

/** MED: looks like a single-brand photo school/pro — queue is_competitor, keep type site. */
export function medSiteSuggest(domain, moneyKw) {
  const d = String(domain || '').toLowerCase();
  if (!d || moneyKw < 2) return null;
  if (highTypeForDomain(d)) return null;
  if (!MED_SITE_HINT.test(d)) return null;
  return {
    domain_type: 'site',
    confidence: 70,
    reason: `queue:is_competitor:med:${moneyKw}-money-kw`,
    suggest_is_competitor: true,
  };
}
