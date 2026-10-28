#!/usr/bin/env node
const { createInterface } = require("node:readline");

// Isolated RPC fixture: no account credentials or model requests are used.
const now = Number(process.env.CODEX_USAGE_QUOTA_RESET_BASE);
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === "account/rateLimits/read" ? {
    rateLimits: {
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: now + 5 * 3600 },
      secondary: { usedPercent: 65, windowDurationMins: 10080, resetsAt: now + 7 * 86400 },
    },
  } : {};
  console.log(JSON.stringify({ id: request.id, result }));
});
