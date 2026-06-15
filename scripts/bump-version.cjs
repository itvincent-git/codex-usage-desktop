const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get version from command line argument
let version = process.argv[2];

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!version) {
  // If no argument, read from package.json (e.g. when run as npm 'version' hook)
  version = pkg.version;
} else {
  // Validate version format (semver)
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    console.error(`Error: Invalid version format "${version}". Expected SemVer (e.g., 1.2.0).`);
    process.exit(1);
  }
  // If argument provided, update package.json version first
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`Updated package.json version to ${version}`);
}

// 1.5. Update changelog.json based on git log since last tag
try {
  updateChangelog(version);
} catch (e) {
  console.warn('Warning: Failed to update changelog.json automatically:', e.message);
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
    try {
      console.log('Updating src-tauri/Cargo.lock...');
      execSync('cargo update -p codex-usage-desktop --manifest-path src-tauri/Cargo.toml');
    } catch (e) {
      console.warn('Warning: Failed to update Cargo.lock using cargo. Please check if Cargo is installed.');
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
  execSync(`git add ${filesToStage.join(' ')}`);
  console.log('Successfully staged version files in git.');
} catch (e) {
  // Silent fail if not in a git repo
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
    previousTag = execSync("git describe --tags --match 'app-v*' --abbrev=0 2>/dev/null", { encoding: 'utf8' }).trim();
  } catch (e) {
    // No previous tag found
  }

  let range = '';
  if (previousTag) {
    range = `${previousTag}..HEAD`;
  }

  let commits = [];
  try {
    const gitLogCmd = range ? `git log --format=%s --reverse ${range}` : 'git log --format=%s --reverse';
    const logOutput = execSync(gitLogCmd, { encoding: 'utf8' });
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
