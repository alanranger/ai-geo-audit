#!/usr/bin/env node
/**
 * Fix critical JavaScript syntax errors in audit-dashboard.html
 * 
 * Fixes:
 * 1. .batchResults -> ...batchResults (spread operator)
 * 2. [.values] -> [...values] (spread in array)
 * 3. [.localEntityData, ...] -> [...localEntityData, ...] (spread in array)
 * 4. { .row, ... } -> { ...row, ... } (spread in object)
 * 5. push(.batchResults) -> push(...batchResults)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(__dirname, 'audit-dashboard.html');

function fixSyntaxErrors(content) {
  let fixed = content;
  let changes = [];
  
  // Pattern 1: push(.batchResults) or push(.anything)
  // Match: push(.variableName) where variableName is a valid identifier
  const pushPattern = /push\(\.([a-zA-Z_$][a-zA-Z0-9_$]*)\)/g;
  let match;
  const pushMatches = [...content.matchAll(pushPattern)];
  pushMatches.forEach(match => {
    const original = match[0];
    const varName = match[1];
    const fixedStr = `push(...${varName})`;
    fixed = fixed.replace(original, fixedStr);
    changes.push({ pattern: 'push(.variable)', original, fixed: fixedStr, line: getLineNumber(content, match.index) });
  });
  
  // Pattern 2: [.values] -> [...values]
  const arraySpreadPattern = /\[\.([a-zA-Z_$][a-zA-Z0-9_$]*)\]/g;
  const arrayMatches = [...content.matchAll(arraySpreadPattern)];
  arrayMatches.forEach(match => {
    const original = match[0];
    const varName = match[1];
    const fixedStr = `[...${varName}]`;
    fixed = fixed.replace(original, fixedStr);
    changes.push({ pattern: '[.variable]', original, fixed: fixedStr, line: getLineNumber(content, match.index) });
  });
  
  // Pattern 3: [.var1, .var2, ...] -> [...var1, ...var2, ...]
  // This is more complex - need to handle multiple variables in array
  // Match arrays that start with .variable (like [.localEntityData, .serviceAreaData, ...])
  const multiArraySpreadPattern = /\[\.([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*,\s*\.([a-zA-Z_$][a-zA-Z0-9_$]*))*[^\]]*\]/g;
  const multiMatches = [...content.matchAll(multiArraySpreadPattern)];
  multiMatches.forEach(match => {
    const original = match[0];
    // Replace each .var with ...var inside the brackets
    const fixedInner = original.replace(/\[(.*)\]/g, (_, inner) => {
      const fixedInner = inner.replace(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '...$1');
      return `[${fixedInner}]`;
    });
    fixed = fixed.replace(original, fixedInner);
    changes.push({ pattern: '[.var1, .var2, ...]', original, fixed: fixedInner, line: getLineNumber(content, match.index) });
  });
  
  // Pattern 4: { .row, ... } -> { ...row, ... }
  const objectSpreadPattern = /\{\s*\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,/g;
  const objectMatches = [...content.matchAll(objectSpreadPattern)];
  objectMatches.forEach(match => {
    const original = match[0];
    const varName = match[1];
    const fixedStr = `{ ...${varName},`;
    fixed = fixed.replace(original, fixedStr);
    changes.push({ pattern: '{ .variable,', original, fixed: fixedStr, line: getLineNumber(content, match.index) });
  });
  
  // Pattern 5: concat(.batchResults) -> concat(...batchResults) or similar function calls
  const functionCallPattern = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(\s*\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g;
  const functionMatches = [...content.matchAll(functionCallPattern)];
  functionMatches.forEach(match => {
    // Skip if it's already push (handled above) or if it's a method call like .push
    if (match[1] === 'push' || match[0].includes('.')) {
      return;
    }
    const original = match[0];
    const funcName = match[1];
    const varName = match[2];
    const fixedStr = `${funcName}(...${varName})`;
    fixed = fixed.replace(original, fixedStr);
    changes.push({ pattern: 'function(.variable)', original, fixed: fixedStr, line: getLineNumber(content, match.index) });
  });
  
  return { fixed, changes };
}

function getLineNumber(content, index) {
  return content.substring(0, index).split('\n').length;
}

function main() {
  console.log('🔍 Scanning audit-dashboard.html for syntax errors...\n');
  
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`❌ File not found: ${FILE_PATH}`);
    process.exit(1);
  }
  
  const content = fs.readFileSync(FILE_PATH, 'utf8');
  const { fixed, changes } = fixSyntaxErrors(content);
  
  if (changes.length === 0) {
    console.log('✅ No syntax errors found!');
    return;
  }
  
  console.log(`⚠️  Found ${changes.length} syntax error(s):\n`);
  changes.forEach((change, idx) => {
    console.log(`${idx + 1}. Line ${change.line}: ${change.pattern}`);
    console.log(`   Before: ${change.original}`);
    console.log(`   After:  ${change.fixed}\n`);
  });
  
  // Create backup
  const backupPath = FILE_PATH + '.backup';
  fs.writeFileSync(backupPath, content, 'utf8');
  console.log(`💾 Backup created: ${backupPath}`);
  
  // Write fixed content
  fs.writeFileSync(FILE_PATH, fixed, 'utf8');
  console.log(`✅ Fixed file written: ${FILE_PATH}`);
  console.log(`\n🎉 All syntax errors fixed!`);
}

// Run if executed directly (check if this file is being run, not imported)
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule || process.argv[1]?.includes('fix-syntax-errors')) {
  main();
}

export { fixSyntaxErrors };

