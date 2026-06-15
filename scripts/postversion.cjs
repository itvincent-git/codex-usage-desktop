const { execSync } = require('child_process');
const path = require('path');
const pkg = require(path.join(__dirname, '../package.json'));
const version = pkg.version;

const wrongTag = `v${version}`;
const correctTag = `app-v${version}`;

try {
  // Check if wrong tag exists
  const tags = execSync(`git tag -l ${wrongTag}`).toString().trim();
  if (tags === wrongTag) {
    console.log(`Found incorrect tag ${wrongTag}, fixing it to ${correctTag}...`);
    // Delete wrong tag
    execSync(`git tag -d ${wrongTag}`);
    // Create correct tag
    execSync(`git tag -a ${correctTag} -m "${correctTag}"`);
    console.log(`Successfully replaced ${wrongTag} with ${correctTag}`);
  } else {
    // Check if correct tag exists
    const correctTags = execSync(`git tag -l ${correctTag}`).toString().trim();
    if (correctTags !== correctTag) {
      execSync(`git tag -a ${correctTag} -m "${correctTag}"`);
      console.log(`Created missing tag ${correctTag}`);
    } else {
      console.log(`Tag ${correctTag} already exists and is correct.`);
    }
  }
} catch (e) {
  console.error('Error in postversion script:', e.message);
}
