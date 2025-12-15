/**
 * Apply domain classifications to database via SQL
 * Uses classifier logic and generates SQL for MCP execution
 */

import { suggestDomainType } from '../lib/domainTypeClassifier.js';
import { normalizeDomain } from '../lib/domainStrength/domains.js';

// Get all domains from database (we'll fetch this via MCP, but for now use a sample)
// In production, this would fetch from domain_strength_snapshots + domain_rank_pending

const domains = [
  '360visualmedia.co.uk', 'adobe.com', 'adult.activatelearning.ac.uk', 'adultlearningbc.ac.uk',
  'aftershoot.com', 'alanranger.com', 'alastaircurrill.com', 'alison.com', 'all-about-photo.com',
  'amateurphotographer.com', 'amazingtalker.co.uk', 'amazon.co.uk', 'ammonitepress.com',
  'andrew-mason.com', 'andrewkingphotography.co.uk', 'andyfarrer.co.uk', 'andytylerphotography.co.uk',
  'artcoursework.com', 'arts.ac.uk', 'ashwoodphotography.co.uk', 'aurorahp.co.uk', 'avcstore.com',
  'baph.co.uk', 'bark.com', 'beachmarketing.co.uk', 'bipp.com', 'blackpool.ac.uk', 'bls.gov',
  'blurb.com', 'bobbooks.co.uk', 'bookanartist.co', 'brentherrig.com', 'brightonmet.ac.uk',
  'candyfoxstudio.com', 'canva.com', 'capturehouse.co.uk', 'carmennorman.co.uk', 'ccn.ac.uk',
  'cewe.co.uk', 'cherrydeck.com', 'chinthaka.co.uk', 'city-academy.com', 'citylit.ac.uk',
  'clairewoodphotography.co.uk', 'clarerenee.co.uk', 'classbento.co.uk', 'classcentral.com',
  'cliftoncameras.co.uk', 'corporatephotographylondon.com', 'coursecloud.org', 'coursehorse.com',
  'coursera.org', 'courses.training.rpsgroup.com', 'coventry.ac.uk', 'coventrycollege.ac.uk',
  'craigaddisonphotography.com', 'craigrobertsphotography.co.uk', 'creativekirklees.com',
  'creativephotographytraining.co.uk', 'crispydog.co.uk', 'cuh.nhs.uk', 'cursa.app',
  'danielbridge.co.uk', 'davidhares.co.uk', 'davidspeightphotography.co.uk', 'dawn2duskphotography.co.uk',
  'dev.photoion.co.uk', 'digital-photography-school.com', 'digitalcameraworld.com', 'dlphoto.co.za',
  'dohertyphotography.co.uk', 'domestika.org', 'dslrphotographycourses.com', 'eastriding.gov.uk',
  'eastridinglibraries.co.uk', 'edc.ac.uk', 'edinburghcollege.ac.uk', 'elliejphotography.co.uk',
  'emmamilestonephotography.co.uk', 'en.wikipedia.org', 'etsy.com', 'eventbrite.com',
  'explorelightphotographyworkshops.com', 'eyemediastudios.co.uk', 'falmouth.ac.uk', 'findtutors.co.uk',
  'fiverr.com', 'fivesixphotography.com', 'focus.picfair.com', 'format.com', 'fujifilm-houseofphotography.com',
  'gobackpacking.com', 'goingdigital.co.uk', 'google.com', 'gregharding.co.uk', 'gretapowell.com',
  'hampshirephotoschool.com', 'headshotcompany.co.uk', 'highlandwildscapes.com', 'highskillstraining.org.uk'
];

const classifications = [];

console.log('🔍 Classifying domains and generating SQL...\n');

for (const domain of domains) {
  const normalized = normalizeDomain(domain);
  if (!normalized) continue;
  
  const suggestion = suggestDomainType(domain);
  if (!suggestion) continue;
  
  classifications.push({
    domain: normalized,
    domain_type: suggestion.domain_type,
    domain_type_source: suggestion.source || 'auto',
    domain_type_confidence: suggestion.confidence,
    domain_type_reason: suggestion.reason,
    segment: suggestion.domain_type // Backward compatibility
  });
}

// Generate SQL for bulk upsert
console.log('📝 Generated SQL for bulk upsert:\n');
console.log('-- Bulk upsert domain classifications');
console.log('INSERT INTO domain_strength_domains (domain, domain_type, domain_type_source, domain_type_confidence, domain_type_reason, segment, label, updated_at)');
console.log('VALUES');

const values = classifications.map((c, i) => {
  const domainEscaped = c.domain.replace(/'/g, "''");
  const reasonEscaped = c.domain_type_reason.replace(/'/g, "''");
  return `  ('${domainEscaped}', '${c.domain_type}', '${c.domain_type_source}', ${c.domain_type_confidence}, '${reasonEscaped}', '${c.segment}', '${domainEscaped}', now())${i < classifications.length - 1 ? ',' : ''}`;
});

console.log(values.join('\n'));
console.log('\nON CONFLICT (domain) DO UPDATE SET');
console.log('  domain_type = EXCLUDED.domain_type,');
console.log('  domain_type_source = EXCLUDED.domain_type_source,');
console.log('  domain_type_confidence = EXCLUDED.domain_type_confidence,');
console.log('  domain_type_reason = EXCLUDED.domain_type_reason,');
console.log('  segment = EXCLUDED.segment,');
console.log('  updated_at = EXCLUDED.updated_at');
console.log('WHERE domain_strength_domains.domain_type_source IS NULL');
console.log('   OR domain_strength_domains.domain_type_source != \'manual\';');

console.log(`\n✅ Generated SQL for ${classifications.length} domains`);

