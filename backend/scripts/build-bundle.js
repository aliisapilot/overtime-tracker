// Bundle generator for Google Apps Script
// Concatenates backend files into a single Dist.gs for simple one-click copy-paste deployment

const fs = require('fs');
const path = require('path');

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

  // Strip Node module checks from bundle
  content = content.replace(/if\s*\(typeof\s+module\s*!==\s*'undefined'[\s\S]*?\}/g, '');

  bundled += '\n// ==========================================\n';
  bundled += '// FILE: ' + relPath + '\n';
  bundled += '// ==========================================\n\n';
  bundled += content + '\n';
});

const outputPath = path.join(backendDir, 'Dist.gs');
fs.writeFileSync(outputPath, bundled, 'utf8');
console.log('Successfully bundled', filesToBundle.length, 'files into', outputPath, '(' + (bundled.length / 1024).toFixed(1) + ' KB)');
