#!/usr/bin/env node
/**
 * Build script to inject the previous commit hash into audit-dashboard.html
 * This runs before deployment to ensure the version pill shows the correct previous commit
 * 
 * Usage: node scripts/inject-previous-commit.js
 * Or add to package.json scripts and run before deployment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  // Get previous commit hash (HEAD~1)
  const previousCommit = execSync('git rev-parse HEAD~1', { encoding: 'utf-8' }).trim();
  const shortHash = previousCommit.substring(0, 7);
  
  console.log(`[Build Script] Previous commit hash: ${shortHash} (${previousCommit})`);
  
  // Read the HTML file
  const htmlPath = path.join(__dirname, '..', 'audit-dashboard.html');
  let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  
  // Replace the fallback commit hash in the async function
  // Update both the API fallback and the catch fallback
  htmlContent = htmlContent.replace(
    /window\.__GAIO_DIAG_BUILD__ = '497151d';/g,
    `window.__GAIO_DIAG_BUILD__ = '${shortHash}';`
  );
  
  // Also update the hardcoded fallback in the API endpoint if it exists
  const apiPath = path.join(__dirname, '..', 'api', 'git', 'previous-commit.js');
  if (fs.existsSync(apiPath)) {
    let apiContent = fs.readFileSync(apiPath, 'utf-8');
    apiContent = apiContent.replace(
      /commitHash: '497151d'/g,
      `commitHash: '${shortHash}'`
    );
    fs.writeFileSync(apiPath, apiContent, 'utf-8');
    console.log(`[Build Script] Updated API endpoint fallback to: ${shortHash}`);
  }
  
  // Write the updated HTML
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
  console.log(`[Build Script] ✓ Updated audit-dashboard.html with previous commit: ${shortHash}`);
  
} catch (error) {
  console.error('[Build Script] Error:', error.message);
  console.warn('[Build Script] Continuing with existing fallback values');
  process.exit(0); // Don't fail the build if this script fails
}
