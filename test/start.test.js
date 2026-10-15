const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateKeyPairSync, createHmac } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const net = require("node:net");
const { configure, start } = require("../start");

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
}).privateKey;

function environment() {
  return { APP_ID: "123", PRIVATE_KEY: privateKey, WEBHOOK_SECRET: "test-secret", OPENAI_API_KEY: "test-key" };
}

test("startup reports missing settings without opening a fake healthy server", () => {
  const env = { ...process.env, NODE_ENV: "production" };
  for (const key of [...Object.keys(environment()), "PRIVATE_KEY_PATH"]) delete env[key];
  const result = spawnSync(process.execPath, ["start.js"], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required environment variables: APP_ID, WEBHOOK_SECRET, OPENAI_API_KEY, PRIVATE_KEY/);
  assert.doesNotMatch(result.stdout, /Listening|limited mode/);
});

test("startup rejects an invalid app ID and invalid private key with useful errors", () => {
  assert.throws(() => configure({ ...environment(), APP_ID: "Iv1.client-id" }), /numeric GitHub App ID/);
  assert.throws(() => configure({ ...environment(), PRIVATE_KEY: "not-a-private-key" }), /full RSA private key/);
});

test("startup accepts pasted PEM with escaped newlines", () => {
  const env = { ...environment(), PRIVATE_KEY: privateKey.replace(/\n/g, "\\n") };
  configure(env);
  assert.equal(env.PRIVATE_KEY, privateKey.trim());
  assert.equal(env.HOST, "0.0.0.0");
});

test("the real startup serves health and verifies signed GitHub webhooks", async (t) => {
  // Reserve a free port rather than assuming a particular developer port is free.
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const originalEnv = { ...process.env };
  Object.assign(process.env, environment(), { PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production", LOG_LEVEL: "fatal" });
  delete process.env.WEBHOOK_PROXY_URL;
  delete process.env.WEBHOOK_PATH;
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });
  const server = await start();
  t.after(() => server.stop());
  const url = `http://127.0.0.1:${port}`;
  const health = await fetch(`${url}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.match(await (await fetch(url)).text(), /\/api\/github\/webhooks/);

  const body = JSON.stringify({ zen: "A test ping" });
  const headers = {
    "content-type": "application/json",
    "x-github-event": "ping",
    "x-github-delivery": "startup-test",
    "x-hub-signature-256": `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`,
  };
  const valid = await fetch(`${url}/api/github/webhooks`, { method: "POST", headers, body });
  assert.ok(valid.status >= 200 && valid.status < 300);
  headers["x-hub-signature-256"] = `sha256=${"0".repeat(64)}`;
  const invalid = await fetch(`${url}/api/github/webhooks`, { method: "POST", headers, body });
  assert.equal(invalid.status, 400);
});
