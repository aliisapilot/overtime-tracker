// Bundle generator for Google Apps Script
// Concatenates backend files into a single Dist.gs for simple one-click copy-paste deployment

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const backendDir = path.join(__dirname, '..');
const filesToBundle = [
  'lib/Config.js',
  'lib/CryptoUtils.js',
  'services/SheetsService.js',
  'services/LocationService.js',
  'services/ShiftService.js',
  'services/OvertimeService.js',
  'services/AdminService.js',
  'services/AuthService.js',
  'Code.gs'
];

let bundled = '/**\n' +
  ' * OVERTIME TRACKER — COMPLETE GOOGLE APPS SCRIPT BACKEND\n' +
  ' * Bundled for single-file deployment at script.google.com\n' +
  ' * Owner: Ateeb\n' +
  ' * Generated: ' + new Date().toISOString() + '\n' +
  ' */\n\n';

filesToBundle.forEach(relPath => {
  const fullPath = path.join(backendDir, relPath);
  let content = fs.readFileSync(fullPath, 'utf8');

  // Cleanly strip Node module export blocks
  const lines = content.split(/\r?\n/);
  const cleaned = [];
  let inModuleExport = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("if (typeof module !== 'undefined'")) {
      inModuleExport = true;
      continue;
    }
    if (inModuleExport) {
      if (trimmed === '}') {
        inModuleExport = false;
      }
      continue;
    }
    cleaned.push(lines[i]);
  }

  content = cleaned.join('\n');

  bundled += '\n// ==========================================\n';
  bundled += '// FILE: ' + relPath + '\n';
  bundled += '// ==========================================\n\n';
  bundled += content + '\n';
});

const outputPath = path.join(backendDir, 'Dist.gs');
fs.writeFileSync(outputPath, bundled, 'utf8');

// Syntax validation
try {
  new vm.Script(bundled);
  console.log('✓ Dist.gs syntax verified: 100% VALID JavaScript');
  console.log('✓ Successfully bundled', filesToBundle.length, 'files into', outputPath, '(' + (bundled.length / 1024).toFixed(1) + ' KB)');
} catch (syntaxErr) {
  console.error('✗ Syntax error in bundled Dist.gs:', syntaxErr);
  process.exit(1);
}
