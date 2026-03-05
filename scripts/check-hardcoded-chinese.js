#!/usr/bin/env node
/**
 * 硬编码中文字符串扫描脚本
 * 
 * 扫描源码中的硬编码中文字符串（排除注释、日志、i18n 文件）
 * 帮助发现遗漏的 i18n 国际化
 * 
 * 使用: npm run check:hardcoded
 *       node scripts/check-hardcoded-chinese.js --strict
 * 
 * 输出分类:
 *   🔴 ERROR   - 用户可见的 UI 文案（label、error、message、placeholder 等）
 *   🟡 WARNING - 可能需要 i18n 的字符串（需人工判断）
 *   ⚪ SKIP    - 已知安全的（注释、日志、i18n 文件等）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const isStrict = process.argv.includes('--strict');

// ==================== 配置 ====================

/** 扫描的目录 */
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

/** 排除的文件 */
const EXCLUDE_FILES = [
  'src/i18n/locales/zh.js',
  'src/i18n/locales/en.js',
  'src/i18n.js',
  'electron/shared/main-i18n.js',
  'electron/shared/tray-labels.js',
];

/** 排除的行模式（正则） */
const EXCLUDE_PATTERNS = [
  /^\s*\/\//,                     // 单行注释
  /^\s*\*/,                       // 多行注释
  /^\s*\/\*/,                     // 多行注释开始
  /logger\./,                     // 日志调用
  /console\./,                    // 控制台输出
  /import\s/,                     // import 语句
  /require\(/,                    // require 语句
  /^\s*\*\s/,                     // JSDoc
];

/** 高优先级上下文（很可能是用户可见文案） */
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

// ==================== 扫描 ====================

/**
 * 检测字符串中是否包含中文
 */
function hasChinese(str) {
  return /[\u4e00-\u9fff]/.test(str);
}

/**
 * 检查行是否应被排除
 */
function shouldExcludeLine(line) {
  return EXCLUDE_PATTERNS.some(p => p.test(line));
}

/**
 * 判断是否高优先级
 */
function isHighPriority(line) {
  return HIGH_PRIORITY_PATTERNS.some(p => p.test(line));
}

/**
 * 扫描单个文件
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings = [];
  
  let inBlockComment = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 跟踪块注释
    if (line.includes('/*')) inBlockComment = true;
    if (line.includes('*/')) { inBlockComment = false; continue; }
    if (inBlockComment) continue;
    
    // 排除模式
    if (shouldExcludeLine(line)) continue;
    
    // 检测中文
    if (!hasChinese(line)) continue;
    
    // 提取中文内容（引号内）
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

/**
 * 递归获取目录下所有 JS/JSX 文件
 */
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

// ==================== 主逻辑 ====================

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
  
  // 输出结果
  if (fileResults.length === 0) {
    console.log('✅ No hardcoded Chinese strings found!\n');
    return;
  }
  
  // 先输出 errors（高优先级）
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
  
  // 再输出 warnings
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
  
  // 总结
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
