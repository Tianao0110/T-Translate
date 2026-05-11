#!/usr/bin/env node
// Scans the source tree for hardcoded Chinese strings (skipping comments,
// logs, and the i18n files themselves) to surface missing i18n coverage.
//
// Usage: npm run check:hardcoded
//        node scripts/check-hardcoded-chinese.js --strict
//
// Output buckets:
//   🔴 ERROR   - user-visible UI text (label / error / message / placeholder ...)
//   🟡 WARNING - probably needs i18n but worth a human look
//   ⚪ SKIP    - safe (comments, logs, i18n source files, etc.)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const isStrict = process.argv.includes('--strict');

const SCAN_DIRS = [
  'src/components',
  'src/services',
  'src/stores',
  'src/config',
  'src/utils',
  'src/windows',
  'electron/ipc',
  'electron/managers',
  'electron/shared',
  'electron/utils',
];

const EXCLUDE_FILES = [
  'src/i18n/locales/zh.js',
  'src/i18n/locales/en.js',
  'src/i18n.js',
  'electron/shared/main-i18n.js',
  'electron/shared/tray-labels.js',
];

const EXCLUDE_PATTERNS = [
  /^\s*\/\//,
  /^\s*\*/,
  /^\s*\/\*/,
  /logger\./,
  /console\./,
  /import\s/,
  /require\(/,
  /^\s*\*\s/,
];

// High-priority contexts likely to be user-facing text.
const HIGH_PRIORITY_PATTERNS = [
  /label\s*[:=]/i,
  /error\s*[:=]/i,
  /message\s*[:=]/i,
  /reason\s*[:=]/i,
  /placeholder\s*[:=]/i,
  /title\s*[:=]/i,
  /description\s*[:=]/i,
  /name\s*[:=]/i,
  /\.error\b/,
  /\.message\b/,
  /return\s*\{[^}]*error:/,
  /return\s*\{[^}]*message:/,
  /sendProgress\(/,
];

function hasChinese(str) {
  return /[\u4e00-\u9fff]/.test(str);
}

function shouldExcludeLine(line) {
  return EXCLUDE_PATTERNS.some(p => p.test(line));
}

function isHighPriority(line) {
  return HIGH_PRIORITY_PATTERNS.some(p => p.test(line));
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings = [];

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('/*')) inBlockComment = true;
    if (line.includes('*/')) { inBlockComment = false; continue; }
    if (inBlockComment) continue;

    if (shouldExcludeLine(line)) continue;

    if (!hasChinese(line)) continue;

    // Extract the Chinese-bearing quoted strings.
    const chineseMatches = line.match(/['"`]([^'"`]*[\u4e00-\u9fff][^'"`]*)['"`]/g);
    if (!chineseMatches) continue;

    const priority = isHighPriority(line) ? 'error' : 'warning';

    findings.push({
      line: i + 1,
      priority,
      content: line.trim(),
      chinese: chineseMatches.map(m => m.slice(1, -1)),
    });
  }

  return findings;
}

function getFiles(dir) {
  const fullDir = path.join(PROJECT_ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];

  const files = [];

  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(fullPath);
      } else if (/\.(js|jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walk(fullDir);
  return files;
}

function main() {
  console.log('🔍 Scanning for hardcoded Chinese strings...\n');

  const excludeSet = new Set(EXCLUDE_FILES.map(f => path.join(PROJECT_ROOT, f)));
  let totalErrors = 0;
  let totalWarnings = 0;
  const fileResults = [];

  for (const dir of SCAN_DIRS) {
    const files = getFiles(dir);

    for (const filePath of files) {
      if (excludeSet.has(filePath)) continue;

      const findings = scanFile(filePath);
      if (findings.length === 0) continue;

      const errors = findings.filter(f => f.priority === 'error');
      const warnings = findings.filter(f => f.priority === 'warning');
      totalErrors += errors.length;
      totalWarnings += warnings.length;

      fileResults.push({
        file: path.relative(PROJECT_ROOT, filePath),
        errors,
        warnings,
        findings,
      });
    }
  }

  if (fileResults.length === 0) {
    console.log('✅ No hardcoded Chinese strings found!\n');
    return;
  }

  const errorFiles = fileResults.filter(r => r.errors.length > 0);
  if (errorFiles.length > 0) {
    console.log('🔴 HIGH PRIORITY (likely user-visible):');
    console.log('─'.repeat(60));
    for (const r of errorFiles) {
      console.log(`\n  📄 ${r.file}`);
      for (const f of r.errors) {
        console.log(`     L${f.line}: ${f.chinese.join(', ')}`);
        if (process.argv.includes('--verbose')) {
          console.log(`           ${f.content.substring(0, 100)}`);
        }
      }
    }
    console.log('');
  }

  const warningFiles = fileResults.filter(r => r.warnings.length > 0);
  if (warningFiles.length > 0) {
    console.log('🟡 LOW PRIORITY (may need review):');
    console.log('─'.repeat(60));
    for (const r of warningFiles) {
      console.log(`\n  📄 ${r.file}`);
      for (const f of r.warnings) {
        console.log(`     L${f.line}: ${f.chinese.join(', ')}`);
      }
    }
    console.log('');
  }

  console.log('═'.repeat(60));
  console.log(`  🔴 ${totalErrors} high-priority findings in ${errorFiles.length} files`);
  console.log(`  🟡 ${totalWarnings} low-priority findings in ${warningFiles.length} files`);
  console.log(`  📊 ${fileResults.length} files with Chinese strings total`);
  console.log('');

  if (totalErrors > 0) {
    console.log('💡 High-priority items are likely user-visible and should use i18n.');
    console.log('   Run with --verbose to see full line content.');
    if (isStrict) process.exit(1);
  } else {
    console.log('✅ No high-priority issues. Low-priority items may be intentional.');
  }
}

main();
