const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-homebrew-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'Casks', 'assets']) fs.mkdirSync(path.join(root, directory));
  fs.copyFileSync(path.join(__dirname, 'update-homebrew-cask.cjs'), path.join(root, 'scripts', 'update-homebrew-cask.cjs'));
  const caskPath = path.join(root, 'Casks', 'codex-usage-desktop.rb');
  fs.copyFileSync(path.join(__dirname, '..', 'Casks', 'codex-usage-desktop.rb'), caskPath);
  const assetsDirectory = path.join(root, 'assets');
  for (const architecture of ['arm64', 'x64']) {
    fs.writeFileSync(path.join(assetsDirectory, `codex-usage-desktop-macos-${architecture}.dmg`), architecture);
  }
  return {
    read: () => fs.readFileSync(caskPath, 'utf8'),
    write: content => fs.writeFileSync(caskPath, content),
    assetsDirectory,
    update: tag => spawnSync(process.execPath, [path.join(root, 'scripts', 'update-homebrew-cask.cjs'), tag, assetsDirectory], {
      encoding: 'utf8'
    })
  };
}

test('migrates a latest cask to a numbered release with checksums for both DMGs', t => {
  const cask = fixture(t);
  const original = cask.read()
    .replace(/^  version .*$/m, '  version :latest')
    .replace(/^  sha256 .*\r?\n +intel: .*$/m, '  sha256 :no_check')
    .replace('releases/download/app-v#{version}/', 'releases/latest/download/');
  cask.write(original);
  const result = cask.update('app-v3.12.0');
  assert.equal(result.status, 0, result.stderr);
  const updated = cask.read();
  assert.match(updated, /version "3\.12\.0"/);
  assert.match(updated, /releases\/download\/app-v#\{version\}\//);
  for (const [architecture, label] of [['arm64', 'arm'], ['x64', 'intel']]) {
    const checksum = createHash('sha256').update(architecture).digest('hex');
    assert.match(updated, new RegExp(`${label}: +"${checksum}"`));
  }
  assert.equal(updated.slice(updated.indexOf('  name ')), original.slice(original.indexOf('  name ')));
});

test('updates numbered releases, compares versions numerically, and is idempotent', t => {
  const cask = fixture(t);
  cask.write(cask.read().replace(/^  version .*$/m, '  version "3.9.0"'));
  assert.equal(cask.update('app-v3.10.0').status, 0);
  assert.match(cask.read(), /version "3\.10\.0"/);
  for (const [architecture, label] of [['arm64', 'arm'], ['x64', 'intel']]) {
    const checksum = createHash('sha256').update(architecture).digest('hex');
    assert.match(cask.read(), new RegExp(`${label}: +"${checksum}"`));
  }
  const updated = cask.read();
  assert.equal(cask.update('app-v3.10.0').status, 0);
  assert.equal(cask.read(), updated);
});

test('updates checksums in CRLF casks while preserving line endings', t => {
  const cask = fixture(t);
  const original = cask.read().replace(/\r?\n/g, '\r\n')
    .replace(/^  version .*$/m, '  version "3.9.0"');
  cask.write(original);
  const result = cask.update('app-v3.10.0');
  assert.equal(result.status, 0, result.stderr);
  const expected = original
    .replace('version "3.9.0"', 'version "3.10.0"')
    .replace(/arm: +"[a-f0-9]{64}"/, `arm:   "${createHash('sha256').update('arm64').digest('hex')}"`)
    .replace(/intel: "[a-f0-9]{64}"/, `intel: "${createHash('sha256').update('x64').digest('hex')}"`);
  assert.equal(cask.read(), expected);
  assert.equal(cask.update('app-v3.10.0').status, 0);
  assert.equal(cask.read(), expected);
});

test('does not downgrade the cask when an older release is rerun', t => {
  const cask = fixture(t);
  cask.write(cask.read().replace(/^  version .*$/m, '  version "3.12.0"'));
  const before = cask.read();
  assert.equal(cask.update('app-v3.9.0').status, 0);
  assert.equal(cask.read(), before);
});

test('rejects non-stable release tags without changing the cask', t => {
  const cask = fixture(t);
  const before = cask.read();
  for (const tag of ['3.12.0', 'app-v3.12.0-beta.1', 'app-v03.12.0']) {
    assert.notEqual(cask.update(tag).status, 0);
    assert.equal(cask.read(), before);
  }
});

test('does not partially update the cask when a DMG is missing', t => {
  const cask = fixture(t);
  const before = cask.read();
  fs.unlinkSync(path.join(cask.assetsDirectory, 'codex-usage-desktop-macos-x64.dmg'));
  assert.notEqual(cask.update('app-v99.0.0').status, 0);
  assert.equal(cask.read(), before);
});
