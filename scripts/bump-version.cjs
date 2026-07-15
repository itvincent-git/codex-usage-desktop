const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { git, printGitFailure } = require('./git-utils.cjs');

// Get version from command line argument
let version = process.argv[2];

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!version || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
  console.error(`Error: Invalid version format "${version || ''}". Expected a stable version (e.g., 1.2.0).`);
  process.exit(1);
}

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Updated package.json version to ${version}`);

// 1.5. Update changelog.json based on git log since last tag
try {
  updateChangelog(version);
} catch (e) {
  console.error('Error: Failed to update changelog.json automatically:', e.message);
  process.exit(1);
}

console.log(`Syncing version ${version} to Tauri configuration...`);

// 2. Update src-tauri/tauri.conf.json
const tauriConfPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
  console.log(`Updated src-tauri/tauri.conf.json version to ${version}`);
}

// 3. Update src-tauri/Cargo.toml
const cargoPath = path.join(__dirname, '../src-tauri/Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  // Use regex to replace version under [package] safely
  cargo = cargo.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m, `$1${version}$2`);
  fs.writeFileSync(cargoPath, cargo, 'utf8');
  console.log(`Updated src-tauri/Cargo.toml version to ${version}`);

  // Update src-tauri/Cargo.lock if it exists
  const cargoLockPath = path.join(__dirname, '../src-tauri/Cargo.lock');
  if (fs.existsSync(cargoLockPath)) {
    console.log('Updating src-tauri/Cargo.lock...');
    try {
      execFileSync('cargo', ['update', '-p', 'codex-usage-desktop', '--manifest-path', 'src-tauri/Cargo.toml'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
    } catch (e) {
      console.error('Error: Failed to update Cargo.lock using cargo. Please check the Cargo output above.');
      process.exit(1);
    }
  }
}

// 4. Stage the updated files in git
try {
  const cargoLockPath = path.join(__dirname, '../src-tauri/Cargo.lock');
  const filesToStage = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'changelog.json'];
  if (fs.existsSync(cargoLockPath)) {
    filesToStage.push('src-tauri/Cargo.lock');
  }
  git(['add', '--', ...filesToStage], { cwd: path.join(__dirname, '..'), retryIndexLock: true });
  console.log('Successfully staged version files in git.');
} catch (e) {
  printGitFailure(e);
  process.exit(1);
}

function updateChangelog(version) {
  const changelogPath = path.join(__dirname, '../changelog.json');
  let changelog = {};
  if (fs.existsSync(changelogPath)) {
    try {
      changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
    } catch (e) {
      console.warn('Warning: Failed to parse changelog.json, starting fresh.');
    }
  }

  // Get the last release tag of format app-v*
  let previousTag = '';
  try {
    previousTag = git(['describe', '--tags', '--match', 'app-v*', '--abbrev=0'], {
      cwd: path.join(__dirname, '..')
    }).trim();
  } catch (e) {
    // No previous tag found
  }

  let range = '';
  if (previousTag) {
    range = `${previousTag}..HEAD`;
  }

  let commits = [];
  try {
    const gitLogArgs = ['log', '--format=%s', '--reverse'];
    if (range) gitLogArgs.push(range);
    const logOutput = git(gitLogArgs, { cwd: path.join(__dirname, '..') });
    commits = logOutput.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    console.warn('Warning: Failed to get git log.');
  }

  // Filter commits (e.g. skip version bumps or merges)
  const versionBumpRegex = /^chore(\([^)]*\))?:\s*\d+\.\d+\.\d+$/i;
  const mergeCommitRegex = /^merge\b/i;
  const filteredCommits = commits.filter(subject => {
    return !versionBumpRegex.test(subject) && !mergeCommitRegex.test(subject);
  });

  if (filteredCommits.length === 0) {
    filteredCommits.push('Minor updates and bug fixes.');
  }

  // Format as bullet points
  const bulletPoints = filteredCommits.map(c => `- ${c}`).join('\n');

  // Order keys: put the new version at the top of the json object
  const newChangelog = {
    [version]: {
      zh: bulletPoints,
      en: bulletPoints
    },
    ...changelog
  };

  fs.writeFileSync(changelogPath, JSON.stringify(newChangelog, null, 2) + '\n', 'utf8');
  console.log(`Updated changelog.json with version ${version}`);
}
