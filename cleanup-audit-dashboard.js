#!/usr/bin/env node
/**
 * Comprehensive cleanup script for audit-dashboard.html
 * 
 * 1. Fix syntax errors (stray dots)
 * 2. Identify duplicate functions
 * 3. Report issues for manual review
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(__dirname, 'audit-dashboard.html');

function findSyntaxErrors(content) {
  const errors = [];
  const lines = content.split('\n');
  
  // Pattern 1: push(.variable)
  const pushPattern = /push\(\.([a-zA-Z_$][a-zA-Z0-9_$]*)\)/g;
  lines.forEach((line, idx) => {
    let match;
    while ((match = pushPattern.exec(line)) !== null) {
      errors.push({
        line: idx + 1,
        type: 'push(.variable)',
        original: match[0],
        suggested: `push(...${match[1]})`,
        context: line.trim()
      });
    }
  });
  
  // Pattern 2: [.variable]
  const arrayPattern = /\[\.([a-zA-Z_$][a-zA-Z0-9_$]*)\]/g;
  lines.forEach((line, idx) => {
    let match;
    while ((match = arrayPattern.exec(line)) !== null) {
      errors.push({
        line: idx + 1,
        type: '[.variable]',
        original: match[0],
        suggested: `[...${match[1]}]`,
        context: line.trim()
      });
    }
  });
  
  // Pattern 3: { .variable,
  const objectPattern = /\{\s*\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,/g;
  lines.forEach((line, idx) => {
    let match;
    while ((match = objectPattern.exec(line)) !== null) {
      errors.push({
        line: idx + 1,
        type: '{ .variable,',
        original: match[0],
        suggested: `{ ...${match[1]},`,
        context: line.trim()
      });
    }
  });
  
  // Pattern 4: = [.variable, .variable, ...]
  const multiArrayPattern = /=\s*\[\.([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*,\s*\.([a-zA-Z_$][a-zA-Z0-9_$]*))*[^\]]*\]/g;
  lines.forEach((line, idx) => {
    let match;
    while ((match = multiArrayPattern.exec(line)) !== null) {
      const fullMatch = match[0];
      const vars = [];
      const varPattern = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
      let varMatch;
      while ((varMatch = varPattern.exec(fullMatch)) !== null) {
        vars.push(varMatch[1]);
      }
      const suggested = `= [\n    ${vars.map(v => `...${v},`).join('\n    ')}\n  ].filter(v => v != null && v !== undefined && !isNaN(v))`;
      errors.push({
        line: idx + 1,
        type: '= [.var1, .var2, ...]',
        original: fullMatch,
        suggested: suggested,
        context: line.trim()
      });
    }
  });
  
  return errors;
}

function findDuplicateFunctions(content) {
  const duplicates = {};
  const functionPattern = /(?:async\s+)?function\s+(\w+)\s*\(/g;
  const lines = content.split('\n');
  
  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const funcName = match[1];
    const lineNum = content.substring(0, match.index).split('\n').length;
    
    if (!duplicates[funcName]) {
      duplicates[funcName] = [];
    }
    duplicates[funcName].push({ line: lineNum, index: match.index });
  }
  
  // Filter to only functions that appear more than once
  const result = {};
  for (const [name, locations] of Object.entries(duplicates)) {
    if (locations.length > 1) {
      result[name] = locations;
    }
  }
  
  return result;
}

function fixSyntaxErrors(content) {
  let fixed = content;
  const errors = findSyntaxErrors(content);
  
  // Apply fixes in reverse order to preserve indices
  errors.reverse().forEach(error => {
    if (error.type === 'push(.variable)') {
      fixed = fixed.replace(error.original, error.suggested);
    } else if (error.type === '[.variable]') {
      fixed = fixed.replace(error.original, error.suggested);
    } else if (error.type === '{ .variable,') {
      fixed = fixed.replace(error.original, error.suggested);
    } else if (error.type === '= [.var1, .var2, ...]') {
      // Need to find the exact line and replace it
      const lines = fixed.split('\n');
      const lineIdx = error.line - 1;
      if (lines[lineIdx]) {
        lines[lineIdx] = lines[lineIdx].replace(/=\s*\[\.([^\]]+)\]/, (match, inner) => {
          const vars = inner.match(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
          if (vars) {
            const spreadVars = vars.map(v => v.replace('.', '...')).join(',\n    ');
            return `= [\n    ${spreadVars}\n  ].filter(v => v != null && v !== undefined && !isNaN(v))`;
          }
          return match;
        });
        fixed = lines.join('\n');
      }
    }
  });
  
  return { fixed, errors };
}

function main() {
  console.log('🔍 Analyzing audit-dashboard.html...\n');
  
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`❌ File not found: ${FILE_PATH}`);
    process.exit(1);
  }
  
  const content = fs.readFileSync(FILE_PATH, 'utf8');
  
  // 1. Find syntax errors
  console.log('1. Checking for syntax errors...');
  const syntaxErrors = findSyntaxErrors(content);
  if (syntaxErrors.length > 0) {
    console.log(`\n⚠️  Found ${syntaxErrors.length} syntax error(s):\n`);
    syntaxErrors.forEach((error, idx) => {
      console.log(`${idx + 1}. Line ${error.line}: ${error.type}`);
      console.log(`   Context: ${error.context.substring(0, 80)}...`);
      console.log(`   Fix: ${error.original} → ${error.suggested}\n`);
    });
    
    // Apply fixes
    const { fixed, errors } = fixSyntaxErrors(content);
    const backupPath = FILE_PATH + '.backup';
    fs.writeFileSync(backupPath, content, 'utf8');
    console.log(`💾 Backup created: ${backupPath}`);
    fs.writeFileSync(FILE_PATH, fixed, 'utf8');
    console.log(`✅ Fixed ${errors.length} syntax error(s)\n`);
  } else {
    console.log('✅ No syntax errors found\n');
  }
  
  // 2. Find duplicate functions
  console.log('2. Checking for duplicate functions...');
  const duplicates = findDuplicateFunctions(content);
  if (Object.keys(duplicates).length > 0) {
    console.log(`\n⚠️  Found ${Object.keys(duplicates).length} function(s) with multiple definitions:\n`);
    for (const [name, locations] of Object.entries(duplicates)) {
      console.log(`${name}:`);
      locations.forEach((loc, idx) => {
        console.log(`  ${idx + 1}. Line ${loc.line}`);
      });
      console.log('');
    }
  } else {
    console.log('✅ No duplicate functions found\n');
  }
  
  // 3. Check for specific functions mentioned
  console.log('3. Checking for key functions...');
  const keyFunctions = [
    'loadRankingAiData',
    'saveRankingAiData',
    'loadRankingAiDataFromStorage',
    'normalizeSummaryFields',
    'renderMoneyKpiTable',
    'buildMoneyPageMetrics'
  ];
  
  keyFunctions.forEach(funcName => {
    const pattern = new RegExp(`(?:async\\s+)?function\\s+${funcName}\\s*\\(`, 'g');
    const matches = [...content.matchAll(pattern)];
    if (matches.length > 1) {
      console.log(`⚠️  ${funcName}: ${matches.length} definitions found`);
      matches.forEach((match, idx) => {
        const lineNum = content.substring(0, match.index).split('\n').length;
        console.log(`   ${idx + 1}. Line ${lineNum}`);
      });
    } else if (matches.length === 1) {
      const lineNum = content.substring(0, matches[0].index).split('\n').length;
      console.log(`✅ ${funcName}: 1 definition at line ${lineNum}`);
    } else {
      console.log(`❌ ${funcName}: Not found`);
    }
  });
  
  console.log('\n📊 Analysis complete!');
}

if (process.argv[1]?.includes('cleanup-audit-dashboard')) {
  main();
}

export { findSyntaxErrors, findDuplicateFunctions, fixSyntaxErrors };

