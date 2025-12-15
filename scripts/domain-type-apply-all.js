/**
 * Classify and apply all 252 domains
 */

import { suggestDomainType } from '../lib/domainTypeClassifier.js';
import { normalizeDomain } from '../lib/domainStrength/domains.js';

// All 252 domains from the database
const allDomains = [
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
  'hampshirephotoschool.com', 'headshotcompany.co.uk', 'highlandwildscapes.com', 'highskillstraining.org.uk',
  'hillsroad.ac.uk', 'hitched.co.uk', 'ideastore.co.uk', 'imagen-ai.com', 'imageseen.co.uk',
  'institute-of-photography.com', 'intotheblue.co.uk', 'ionactive.co.uk', 'iphotography.com',
  'jackgrayphotography.co.uk', 'jacklodge.co.uk', 'james-robinson.co.uk', 'jamesaphotography.co.uk',
  'jamesgphotography.co.uk', 'jamesratchfordphotography.com', 'jasonrowphotography.co.uk', 'jeaphotography.co.uk',
  'jennabechtholt.com', 'jessops.com', 'joscottimages.co.uk', 'jphotographers.co.uk', 'justdial.com',
  'justinminns.co.uk', 'kalory.co.uk', 'kasefilters.eu', 'koby.photography', 'learning.mastersof.photography',
  'lightandland.co.uk', 'lillianspibeyphotography.com', 'liop.co.uk', 'liv-coll.ac.uk', 'louiserosephotography.com',
  'magnumphotos.com', 'manchesterschoolofphotography.com', 'marksisley.co.uk', 'masterclass.com',
  'mastersof.photography', 'matthewjoseph.co.uk', 'maxinesarahphotography.com', 'maxphoto.co.uk',
  'media-village.co.uk', 'meganposeinphotography.com', 'melvinnicholsonphotography.co.uk', 'memorycake.co.uk',
  'microfournerds.com', 'mkweddingphotography.com', 'myclickmagazine.com', 'nationaltrust.org.uk',
  'naturettl.com', 'ncchomelearning.co.uk', 'neonlightphotography.com', 'nigelhicks.com',
  'northlight-images.co.uk', 'northwestphotographycourses.com', 'nottinghamcollege.ac.uk', 'ollietaylorphotography.com',
  'open.ac.uk', 'outdoorphotographymagazine.co.uk', 'parkcameras.com', 'paulcrawford.com',
  'pauldavidsmith.co.uk', 'paulreidphotography.com', 'peakdigitaltraining.net', 'peopleperhour.com',
  'perfocal.com', 'peterthomasphotography.com', 'photobox.co.uk', 'photographerforhire.co.uk',
  'photographycourselondon.com', 'photographycourses.biz', 'photosbyzaman.com', 'pixelhaze.academy',
  'pixpa.com', 'poptop.uk.com', 'prodoto.com', 'professionalphotographer.london', 'radman.co.uk',
  'reddit.com', 'reed.co.uk', 'rhubarbandcustard.com', 'robertcanis.com', 'rolandblunk.com',
  'rosshoddinott.co.uk', 'rowansims.com', 'rpharms.com', 'rps.org', 'rpsgroup.com',
  'samboughton.co.uk', 'samrichardsonimage.co.uk', 'serenabolton.com', 'sharpshotsphotoclub.co.uk',
  'shcg.ac.uk', 'simonellingworth.com', 'simonwiffenphotography.co.uk', 'simplycphotography.co.uk',
  'simplygreatshots.co.uk', 'skillsandlearningace.com', 'skillshare.com', 'skywallphotography.com',
  'snappr.com', 'socialtables.com', 'southstaffs.ac.uk', 'spencercobby.co.uk', 'splento.com',
  'stevehedgesphotography.co.uk', 'streetsnappers.com', 'stuartbaileyphoto.com', 'stubrownphotography.co.uk',
  'superprof.co.uk', 'surreycc.gov.uk', 'suttoncollege.ac.uk', 'tealhq.com', 'tesniward.co.uk',
  'the-aop.org', 'theartcareerproject.com', 'thecotswoldphotographer.com', 'thefocalpointhub.com',
  'thephotographersgallery.org.uk', 'thephotographersmentor.com', 'thephotographyproject.co.uk',
  'theschoolofphotography.com', 'thesocieties.net', 'tomtrevatt.com', 'topuniversities.com',
  'trovatten.com', 'tutorful.co.uk', 'udemy.com', 'uk-photo-tours.com', 'uk.trustpilot.com',
  'ukhsa-protectionservices.org.uk', 'ukprepaidsimcard.com.au', 'uktutors.com', 'uniqueimagephotography.co.uk',
  'upskillist.com', 'upwork.com', 'venturephotography.com', 'virginexperiencedays.co.uk',
  'visualeducation.com', 'visualwilderness.com', 'vocal.media', 'walking.photography',
  'wexphotovideo.com', 'wildlifeworldwide.com', 'wildphotographer.co.uk', 'wilkinson.co.uk',
  'windsor-forest.ac.uk', 'wish-photography.co.uk', 'www1.ayrshire.ac.uk', 'xchangetraining.co.uk',
  'yorkshirephotocourses.co.uk', 'youtube.com', 'zno.com'
];

const classifications = [];
const summary = {
  by_type: {},
  by_source: {},
  by_confidence_band: { high: 0, medium: 0, low: 0 },
  total: 0,
  classified: 0,
  failed: 0
};

console.log(`🔍 Classifying ${allDomains.length} domains...\n`);

for (const domain of allDomains) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    summary.failed++;
    continue;
  }
  
  summary.total++;
  const suggestion = suggestDomainType(domain);
  
  if (!suggestion) {
    summary.failed++;
    continue;
  }
  
  summary.classified++;
  summary.by_type[suggestion.domain_type] = (summary.by_type[suggestion.domain_type] || 0) + 1;
  summary.by_source[suggestion.source] = (summary.by_source[suggestion.source] || 0) + 1;
  
  const confBand = suggestion.confidence >= 80 ? 'high' : suggestion.confidence >= 50 ? 'medium' : 'low';
  summary.by_confidence_band[confBand]++;
  
  classifications.push({
    domain: normalized,
    domain_type: suggestion.domain_type,
    domain_type_source: suggestion.source || 'auto',
    domain_type_confidence: suggestion.confidence,
    domain_type_reason: suggestion.reason,
    segment: suggestion.domain_type
  });
}

// Generate SQL batches (50 domains per batch)
const sqlBatches = [];
const batchSize = 50;

for (let i = 0; i < classifications.length; i += batchSize) {
  const batch = classifications.slice(i, i + batchSize);
  
  let sql = 'INSERT INTO domain_strength_domains (domain, domain_type, domain_type_source, domain_type_confidence, domain_type_reason, segment, label, updated_at)\nVALUES\n';
  
  const values = batch.map((c, idx) => {
    const domainEscaped = c.domain.replace(/'/g, "''");
    const reasonEscaped = c.domain_type_reason.replace(/'/g, "''");
    return `  ('${domainEscaped}', '${c.domain_type}', '${c.domain_type_source}', ${c.domain_type_confidence}, '${reasonEscaped}', '${c.segment}', '${domainEscaped}', now())${idx < batch.length - 1 ? ',' : ''}`;
  });
  
  sql += values.join('\n');
  sql += '\nON CONFLICT (domain) DO UPDATE SET\n';
  sql += '  domain_type = EXCLUDED.domain_type,\n';
  sql += '  domain_type_source = EXCLUDED.domain_type_source,\n';
  sql += '  domain_type_confidence = EXCLUDED.domain_type_confidence,\n';
  sql += '  domain_type_reason = EXCLUDED.domain_type_reason,\n';
  sql += '  segment = EXCLUDED.segment,\n';
  sql += '  updated_at = EXCLUDED.updated_at\n';
  sql += "WHERE domain_strength_domains.domain_type_source IS NULL\n";
  sql += "   OR domain_strength_domains.domain_type_source != 'manual';\n";
  
  sqlBatches.push(sql);
}

console.log('='.repeat(60));
console.log('📊 Classification Summary:');
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
      const pct = ((count / summary.classified) * 100).toFixed(1);
      console.log(`    ${type.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
    });
}

if (Object.keys(summary.by_source).length > 0) {
  console.log('\n  By source:');
  Object.entries(summary.by_source)
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      const pct = ((count / summary.classified) * 100).toFixed(1);
      console.log(`    ${source.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
    });
}

console.log('\n  By confidence band:');
console.log(`    High (≥80%)          ${summary.by_confidence_band.high}`);
console.log(`    Medium (50-79%)      ${summary.by_confidence_band.medium}`);
console.log(`    Low (<50%)           ${summary.by_confidence_band.low}`);

console.log('='.repeat(60));
console.log(`\n✅ Generated ${sqlBatches.length} SQL batches`);
console.log(`   Total classifications: ${classifications.length}\n`);

// Export SQL batches for application
export { sqlBatches, classifications, summary };

