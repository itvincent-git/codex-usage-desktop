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
}

// 4. Stage the updated files in git
try {
  execSync('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
  console.log('Successfully staged version files in git.');
} catch (e) {
  // Silent fail if not in a git repo
}
