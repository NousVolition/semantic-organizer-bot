const { createPrivateKey } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function configure(env) {
  const required = ["APP_ID", "WEBHOOK_SECRET", "OPENAI_API_KEY"];
  const missing = required.filter((name) => !env[name]?.trim());
  if (!env.PRIVATE_KEY?.trim() && !env.PRIVATE_KEY_PATH?.trim()) {
    missing.push("PRIVATE_KEY (or PRIVATE_KEY_PATH)");
  }
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}. Set them in Render > Environment.`);
  }
  if (!/^\d+$/.test(env.APP_ID.trim()) || Number(env.APP_ID) <= 0) {
    throw new Error("APP_ID must be the numeric GitHub App ID, not the app name or client ID.");
  }

  let privateKey;
  try {
    privateKey = env.PRIVATE_KEY?.trim() || readFileSync(resolve(env.PRIVATE_KEY_PATH.trim()), "utf8");
    // Accept a PEM pasted as multiple lines or with literal \\n escapes.
    privateKey = privateKey.replace(/\\n/g, "\n").trim();
    if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") throw new Error("Not RSA");
  } catch {
    throw new Error("PRIVATE_KEY must contain the full RSA private key downloaded from your GitHub App, or PRIVATE_KEY_PATH must point to that PEM file.");
  }
  env.APP_ID = env.APP_ID.trim();
  env.PRIVATE_KEY = privateKey;
  env.OPENAI_API_KEY = env.OPENAI_API_KEY.trim();
  env.HOST ||= "0.0.0.0";
}

async function start() {
  require("dotenv").config();
  configure(process.env);
  const { run } = require("probot");
  // run() needs the application function, and its Promise must be awaited.
  return run(require("./index.js"));
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`Bot startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { configure, start };
