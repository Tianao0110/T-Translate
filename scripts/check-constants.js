#!/usr/bin/env node
/**
 * 常量同步检查脚本
 * 
 * 验证 electron/shared/constants.js 和 src/config/constants.js 中的
 * 核心常量是否保持同步
 * 
 * 使用: npm run check:constants
 */

const fs = require('fs');
const path = require('path');

// 文件路径
const electronConstantsPath = path.join(__dirname, '../electron/shared/constants.js');
const srcConstantsPath = path.join(__dirname, '../src/config/constants.js');

// 需要检查同步的常量名
const CONSTANTS_TO_CHECK = [
  'PRIVACY_MODES',
  'THEMES',
  'OCR_ENGINES',
  'DEFAULTS',
  'PROVIDER_IDS',
];

/**
 * 从文件内容中提取常量值
 */
function extractConstant(content, name) {
  // 匹配 const NAME = { ... } 或 export const NAME = { ... }
  const regex = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*=\\s*({[\\s\\S]*?});`,
    'm'
  );
  const match = content.match(regex);
  if (match) {
    try {
      // 简单评估对象字面量（注意：这不处理复杂情况）
      // 只提取键值对
      const objStr = match[1]
        .replace(/\/\/.*$/gm, '')  // 移除单行注释
        .replace(/,\s*}/g, '}');   // 移除尾逗号
      
      return objStr;
    } catch (e) {
      return match[1];
    }
  }
  return null;
}

/**
 * 规范化对象字符串以便比较
 */
function normalizeObjString(str) {
  if (!str) return '';
  return str
    .replace(/\s+/g, ' ')           // 合并空白
    .replace(/'/g, '"')             // 统一引号
    .replace(/,\s*}/g, '}')         // 移除尾逗号
    .replace(/{\s*/g, '{')          // 移除括号后空白
    .replace(/\s*}/g, '}')          // 移除括号前空白
    .replace(/:\s*/g, ':')          // 移除冒号后空白
    .replace(/,\s*/g, ',')          // 移除逗号后空白
    .trim();
}

/**
 * 比较两个常量
 */
function compareConstants(name, electronContent, srcContent) {
  const electronValue = extractConstant(electronContent, name);
  const srcValue = extractConstant(srcContent, name);
  
  if (!electronValue) {
    return { name, status: 'missing_electron', message: `${name} not found in electron constants` };
  }
  
  if (!srcValue) {
    return { name, status: 'missing_src', message: `${name} not found in src constants` };
  }
  
  const normalizedElectron = normalizeObjString(electronValue);
  const normalizedSrc = normalizeObjString(srcValue);
  
  if (normalizedElectron === normalizedSrc) {
    return { name, status: 'synced', message: `${name} ✓` };
  } else {
    return { 
      name, 
      status: 'mismatch', 
      message: `${name} MISMATCH!`,
      electron: electronValue.substring(0, 100),
      src: srcValue.substring(0, 100)
    };
  }
}

// 主逻辑
function main() {
  console.log('🔍 Checking constants synchronization...\n');
  
  // 读取文件
  let electronContent, srcContent;
  
  try {
    electronContent = fs.readFileSync(electronConstantsPath, 'utf-8');
  } catch (e) {
    console.error(`❌ Cannot read ${electronConstantsPath}`);
    process.exit(1);
  }
  
  try {
    srcContent = fs.readFileSync(srcConstantsPath, 'utf-8');
  } catch (e) {
    console.error(`❌ Cannot read ${srcConstantsPath}`);
    process.exit(1);
  }
  
  // 检查每个常量
  const results = CONSTANTS_TO_CHECK.map(name => 
    compareConstants(name, electronContent, srcContent)
  );
  
  // 输出结果
  let hasError = false;
  
  results.forEach(result => {
    if (result.status === 'synced') {
      console.log(`  ✅ ${result.name}`);
    } else if (result.status === 'missing_electron' || result.status === 'missing_src') {
      console.log(`  ⚠️  ${result.message}`);
    } else {
      console.log(`  ❌ ${result.message}`);
      hasError = true;
    }
  });
  
  console.log('');
  
  if (hasError) {
    console.log('❌ Constants are OUT OF SYNC!');
    console.log('   Please update src/config/constants.js to match electron/shared/constants.js');
    process.exit(1);
  } else {
    console.log('✅ Constants are in sync!');
    process.exit(0);
  }
}

main();
