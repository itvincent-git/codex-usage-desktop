const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const [tag, assetsDirectory] = process.argv.slice(2);
const match = /^app-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag || '');
if (process.argv.length !== 4 || !match || !assetsDirectory) {
  console.error('Usage: node scripts/update-homebrew-cask.cjs <app-vx.y.z> <assets-directory>');
  process.exit(1);
}

const version = match[1];
const caskPath = path.join(__dirname, '..', 'Casks', 'codex-usage-desktop.rb');
const cask = fs.readFileSync(caskPath, 'utf8');
const newline = cask.includes('\r\n') ? '\r\n' : '\n';
const currentVersion = /^  version "(\d+\.\d+\.\d+)"$/m.exec(cask)?.[1];
if (currentVersion) {
  const current = currentVersion.split('.').map(Number);
  const next = version.split('.').map(Number);
  const difference = next.map((part, index) => part - current[index]).find(part => part !== 0);
  if (difference < 0) {
    console.log(`Skipping ${tag}: the Homebrew cask already tracks ${currentVersion}.`);
    process.exit(0);
  }
}

function checksum(architecture) {
  const asset = fs.readFileSync(path.join(assetsDirectory, `codex-usage-desktop-macos-${architecture}.dmg`));
  return createHash('sha256').update(asset).digest('hex');
}

const updated = cask
  .replace(/^  version (?:"\d+\.\d+\.\d+"|:latest)$/m, `  version "${version}"`)
  .replace(/^  sha256 (?::no_check|arm: +"[a-f0-9]{64}",\r?\n +intel: "[a-f0-9]{64}")$/m,
    `  sha256 arm:   "${checksum('arm64')}",${newline}         intel: "${checksum('x64')}"`)
  .replace(/releases\/(?:latest\/download|download\/app-v#\{version\})\//,
    'releases/download/app-v#{version}/');

fs.writeFileSync(caskPath, updated);
console.log(`Updated Homebrew cask to ${version}.`);
