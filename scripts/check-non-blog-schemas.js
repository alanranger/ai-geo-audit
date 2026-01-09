#!/usr/bin/env node

/**
 * Check non-blog pages to see what schema files they should load
 */

const testUrls = [
  'https://www.alanranger.com/photography-services-near-me/composition-settings-photography-field-checklists',
  'https://www.alanranger.com/about-alan-ranger',
  'https://www.alanranger.com/photographic-workshops-near-me/abstract-and-macro-photography-workshop',
  'https://www.alanranger.com/blog-on-photography',
  'https://www.alanranger.com/home'
];

async function checkUrl(url) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Checking: ${url}`);
  console.log('='.repeat(80));
  
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    // Extract slug
    const slugMatch = url.match(/\/([^\/]+)\/?$/);
    const slug = slugMatch ? slugMatch[1] : null;
    
    console.log(`\nExtracted slug: ${slug || 'none'}`);
    
    // Check for dynamic loader
    const hasLoader = /schema\.alanranger\.com/i.test(html) && (/function/i.test(html) || /fetch\(/i.test(html));
    console.log(`Has dynamic loader: ${hasLoader}`);
    
    if (hasLoader) {
      // Find the loader script
      const scriptRegex = /<script[^>]*>([\s\S]*?schema\.alanranger\.com[\s\S]*?)<\/script>/gi;
      const matches = [...html.matchAll(scriptRegex)];
      
      if (matches.length > 0) {
        console.log(`\nFound ${matches.length} loader script(s):`);
        matches.forEach((match, idx) => {
          const scriptContent = match[1];
          console.log(`\n  Script ${idx + 1} (first 500 chars):`);
          console.log(`  ${scriptContent.substring(0, 500)}`);
          
          // Try to extract schema file patterns
          const filePatterns = scriptContent.match(/['"`]([^'"`]+\.json)['"`]/g);
          if (filePatterns) {
            console.log(`  \n  Schema files mentioned:`);
            filePatterns.forEach(p => console.log(`    ${p}`));
          }
          
          // Try to extract path patterns
          const pathPatterns = scriptContent.match(/pathname[^}]*}/g);
          if (pathPatterns) {
            console.log(`  \n  Path patterns:`);
            pathPatterns.forEach(p => console.log(`    ${p.substring(0, 100)}`));
          }
        });
      }
    }
    
    // Try common schema file patterns
    if (slug) {
      console.log(`\n\nTrying common schema file patterns for slug: ${slug}`);
      const patterns = [
        `${slug}_schema.json`,
        `${slug}_breadcrumb.json`,
        `breadcrumb.json`,
        `schema.json`
      ];
      
      // Also try path-based patterns
      const pathMatch = url.match(/\/([^\/]+\/[^\/]+)\/?$/);
      if (pathMatch) {
        const pathSlug = pathMatch[1].replace(/\//g, '-');
        patterns.push(`${pathSlug}_schema.json`, `${pathSlug}_breadcrumb.json`);
      }
      
      for (const fileName of patterns) {
        try {
          const schemaUrl = `https://schema.alanranger.com/${fileName}`;
          const schemaResponse = await fetch(schemaUrl);
          if (schemaResponse.ok) {
            const schemaData = await schemaResponse.json();
            console.log(`  ✅ Found: ${fileName} (@type=${schemaData['@type'] || 'array'})`);
          } else {
            console.log(`  ❌ Not found: ${fileName} (${schemaResponse.status})`);
          }
        } catch (e) {
          console.log(`  ❌ Error: ${fileName} - ${e.message}`);
        }
      }
    }
    
    // Check for static JSON-LD BreadcrumbList
    const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    const jsonLdMatches = [...html.matchAll(jsonLdRegex)];
    
    let foundBreadcrumb = false;
    jsonLdMatches.forEach((match, idx) => {
      const jsonText = match[1].trim();
      if (/BreadcrumbList/i.test(jsonText)) {
        console.log(`\n  ✅ Found BreadcrumbList in JSON-LD script ${idx + 1}`);
        foundBreadcrumb = true;
      }
    });
    
    if (!foundBreadcrumb) {
      console.log(`\n  ❌ No BreadcrumbList found in static JSON-LD`);
    }
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

async function main() {
  for (const url of testUrls) {
    await checkUrl(url);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(console.error);

