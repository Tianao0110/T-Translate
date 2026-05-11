#!/usr/bin/env node
// Verifies that the core constants in electron/shared/constants.js and
// src/config/constants.js stay in sync.
//
// Usage: npm run check:constants

const fs = require('fs');
const path = require('path');

const electronConstantsPath = path.join(__dirname, '../electron/shared/constants.js');
const srcConstantsPath = path.join(__dirname, '../src/config/constants.js');

const CONSTANTS_TO_CHECK = [
  'PRIVACY_MODES',
  'THEMES',
  'OCR_ENGINES',
  'DEFAULTS',
  'PROVIDER_IDS',
];

function extractConstant(content, name) {
  const regex = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*=\\s*({[\\s\\S]*?});`,
    'm'
  );
  const match = content.match(regex);
  if (match) {
    try {
      // Strip line comments and trailing commas before comparing.
      const objStr = match[1]
        .replace(/\/\/.*$/gm, '')
        .replace(/,\s*}/g, '}');

      return objStr;
    } catch (e) {
      return match[1];
    }
  }
  return null;
}

function normalizeObjString(str) {
  if (!str) return '';
  return str
    .replace(/\s+/g, ' ')
    .replace(/'/g, '"')
    .replace(/,\s*}/g, '}')
    .replace(/{\s*/g, '{')
    .replace(/\s*}/g, '}')
    .replace(/:\s*/g, ':')
    .replace(/,\s*/g, ',')
    .trim();
}

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

function main() {
  console.log('🔍 Checking constants synchronization...\n');

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

  const results = CONSTANTS_TO_CHECK.map(name =>
    compareConstants(name, electronContent, srcContent)
  );

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
