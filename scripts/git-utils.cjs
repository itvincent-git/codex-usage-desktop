const { spawnSync } = require('child_process');

const LOCK_RETRY_DELAYS_MS = [100, 200, 400, 800, 1000, 1000, 1000, 500];

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isIndexLockContention(output) {
  return /(?:unable to create .*index\.lock|could not lock (?:the )?index|index\.lock.*file exists)/i.test(output);
}

function git(args, options = {}) {
  const { cwd = process.cwd(), retryIndexLock = false } = options;

  for (let attempt = 0; ; attempt += 1) {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (result.status === 0) {
      return result.stdout;
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const delay = LOCK_RETRY_DELAYS_MS[attempt];
    if (retryIndexLock && delay !== undefined && isIndexLockContention(output)) {
      console.error(`Git index is locked; retrying in ${delay}ms...`);
      sleep(delay);
      continue;
    }

    const command = `git ${args.join(' ')}`;
    const error = new Error(output.trim() || `${command} failed with exit code ${result.status}`);
    error.code = result.status;
    error.command = command;
    error.indexLockContention = isIndexLockContention(output);
    throw error;
  }
}

function printGitFailure(error) {
  console.error(error.message);
  if (error.indexLockContention) {
    console.error(
      'Git remained locked. Check for an active Git process; if none exists, inspect .git/index.lock and remove it manually only when it is safe.'
    );
  }
}

module.exports = { git, printGitFailure };
