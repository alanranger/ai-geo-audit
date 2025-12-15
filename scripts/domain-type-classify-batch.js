/**
 * Batch domain classification using classifier logic
 * Outputs classification results for manual review or SQL execution
 */

import { suggestDomainType } from '../lib/domainTypeClassifier.js';
import { normalizeDomain } from '../lib/domainStrength/domains.js';

// Sample domains from the database query
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

const summary = {
  by_type: {},
  by_source: {},
  by_confidence_band: { high: 0, medium: 0, low: 0 },
  total: 0,
  classified: 0,
  failed: 0
};

console.log('🔍 Classifying domains...\n');

for (const domain of domains) {
  const suggestion = suggestDomainType(domain);
  summary.total++;
  
  if (suggestion) {
    summary.classified++;
    summary.by_type[suggestion.domain_type] = (summary.by_type[suggestion.domain_type] || 0) + 1;
    summary.by_source[suggestion.source] = (summary.by_source[suggestion.source] || 0) + 1;
    
    const confBand = suggestion.confidence >= 80 ? 'high' : suggestion.confidence >= 50 ? 'medium' : 'low';
    summary.by_confidence_band[confBand]++;
    
    console.log(`${domain.padEnd(40)} → ${suggestion.domain_type.padEnd(15)} (${suggestion.confidence}% ${suggestion.source})`);
  } else {
    summary.failed++;
    console.log(`${domain.padEnd(40)} → FAILED (parse error)`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('📊 Summary:');
console.log('='.repeat(60));
console.log(`  Total domains:        ${summary.total}`);
console.log(`  Classified:            ${summary.classified}`);
console.log(`  Failed:                ${summary.failed}`);
console.log(`  Coverage:              ${((summary.classified / summary.total) * 100).toFixed(1)}%`);

if (Object.keys(summary.by_type).length > 0) {
  console.log('\n  By type:');
  Object.entries(summary.by_type)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`    ${type.padEnd(20)} ${count}`);
    });
}

if (Object.keys(summary.by_source).length > 0) {
  console.log('\n  By source:');
  Object.entries(summary.by_source)
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      console.log(`    ${source.padEnd(20)} ${count}`);
    });
}

console.log('\n  By confidence band:');
console.log(`    High (≥80%)          ${summary.by_confidence_band.high}`);
console.log(`    Medium (50-79%)      ${summary.by_confidence_band.medium}`);
console.log(`    Low (<50%)           ${summary.by_confidence_band.low}`);

console.log('='.repeat(60));

