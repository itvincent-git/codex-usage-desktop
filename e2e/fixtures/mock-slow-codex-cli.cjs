#!/usr/bin/env node
const { createInterface } = require("node:readline");

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const reply = (result) => console.log(JSON.stringify({ id: request.id, result }));
  if (request.method === "account/rateLimits/read") {
    // A valid remote response can take longer than the former three-second timeout.
    setTimeout(() => reply({
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1_800_000_000 },
      },
    }), 4_000);
  } else {
    reply({});
  }
});
