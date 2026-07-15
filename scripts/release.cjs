const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { git, printGitFailure } = require('./git-utils.cjs');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const argument = process.argv[2];

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseVersion(value) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)) return null;
  return value.split('.').map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

if (process.argv.length !== 3 || !argument) {
  fail('Usage: pnpm release <major|minor|patch|x.y.z>');
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const current = parseVersion(pkg.version);
if (!current) fail(`Current package version "${pkg.version}" is not a stable version.`);

let target;
if (argument === 'major') target = [current[0] + 1, 0, 0];
else if (argument === 'minor') target = [current[0], current[1] + 1, 0];
else if (argument === 'patch') target = [current[0], current[1], current[2] + 1];
else target = parseVersion(argument);

if (!target) fail(`Invalid release "${argument}". Use major, minor, patch, or a stable version such as 1.2.3.`);
if (compareVersions(target, current) <= 0) {
  fail(`Target version ${target.join('.')} must be greater than current version ${pkg.version}.`);
}

const version = target.join('.');
const tag = `app-v${version}`;

try {
  const status = git(['status', '--porcelain', '--untracked-files=all'], { cwd: root, retryIndexLock: true }).trim();
  if (status) {
    fail(`Git working tree must be clean before creating a release:\n${status}`);
  }
  if (git(['tag', '--list', tag], { cwd: root }).trim() === tag) {
    fail(`Tag ${tag} already exists.`);
  }
} catch (error) {
  printGitFailure(error);
  process.exit(1);
}

const bump = spawnSync(process.execPath, [path.join(__dirname, 'bump-version.cjs'), version], {
  cwd: root,
  stdio: 'inherit'
});
if (bump.status !== 0) process.exit(bump.status || 1);

try {
  git(['commit', '-m', version], { cwd: root, retryIndexLock: true });
  git(['tag', '-a', tag, '-m', tag], { cwd: root });

  if (git(['status', '--porcelain', '--untracked-files=all'], { cwd: root, retryIndexLock: true }).trim()) {
    throw new Error('Release commit was created, but the Git working tree is not clean.');
  }
} catch (error) {
  printGitFailure(error);
  process.exit(1);
}

console.log(`Created release commit ${version} and annotated tag ${tag}.`);
console.log('Push the commit and tag when you are ready.');
