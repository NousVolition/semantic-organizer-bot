const assert = require("node:assert/strict");
const { test, beforeEach, afterEach } = require("node:test");
const nock = require("nock");
const { Probot } = require("probot");
const app = require("../index");

let probot;
let unmatched;
function recordUnmatched(request) {
  unmatched.push(request.path || request.url || "Unexpected HTTP request");
}
const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_MODEL;
beforeEach(async () => {
  unmatched = [];
  nock.emitter.on("no match", recordUnmatched);
  nock.disableNetConnect();
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.OPENAI_MODEL;
  probot = new Probot({ githubToken: "test-token", logLevel: "fatal" });
  await probot.load(app);
});
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.emitter.removeListener("no match", recordUnmatched);
  nock.cleanAll();
  nock.enableNetConnect();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = originalModel;
  assert.deepEqual(pending, []);
  assert.deepEqual(unmatched, []);
});

const repository = { name: "demo", owner: { login: "example" }, default_branch: "develop" };
const source = "This explanation could be clearer and more precise for readers.";
function completion(output) {
  return nock("https://api.openai.com")
    .post("/v1/chat/completions", (body) => body.model === "gpt-4o-mini" && body.messages.at(-1).content.includes(source))
    .reply(200, { choices: [{ message: { content: output } }] });
}
function receive(name, payload) {
  return probot.receive({ id: `test-${name}`, name, payload: { repository, sender: { type: "User" }, ...payload } });
}

test("issues produce an improved version and language notes through the real SDKs", async () => {
  completion("A clearer explanation.");
  completion("Looks solid.");
  nock("https://api.github.com").post("/repos/example/demo/issues/7/comments", {
    body: "### Clearer version\n\n---\nA clearer explanation.\n---",
  }).reply(201, { id: 1 });
  nock("https://api.github.com").post("/repos/example/demo/issues/7/comments", {
    body: "### Language notes\n\nLooks solid.",
  }).reply(201, { id: 2 });
  await receive("issues", { action: "opened", issue: { number: 7, body: source, user: { type: "User" } } });
});

test("pull requests produce comments on the correct PR", async () => {
  completion("A clearer PR description.");
  completion("A related idea.");
  nock("https://api.github.com").post("/repos/example/demo/issues/8/comments", (body) => body.body.includes("A clearer PR description.")).reply(201, { id: 1 });
  nock("https://api.github.com").post("/repos/example/demo/issues/8/comments", (body) => body.body.includes("A related idea.")).reply(201, { id: 2 });
  await receive("pull_request", { action: "opened", pull_request: { number: 8, title: "Clarify documentation", body: source } });
});

test("push scanning follows the repository's actual default branch", async () => {
  completion("Some language notes.");
  nock("https://api.github.com").post("/repos/example/demo/issues", (body) => {
    assert.equal(body.title, "Language notes from recent changes");
    assert.match(body.body, /Some language notes/);
    return true;
  }).reply(201, { number: 9 });
  await receive("push", { ref: "refs/heads/develop", commits: [{ message: source }] });
});

test("other branches, branch deletions, and empty pushes do not call any API", async () => {
  await receive("push", { ref: "refs/heads/main", commits: [{ message: source }] });
  await receive("push", { ref: "refs/heads/develop", deleted: true, commits: [{ message: source }] });
  await receive("push", { ref: "refs/heads/develop", commits: [] });
});

test("the bot ignores its own generated issues and other bot events", async () => {
  await receive("issues", { action: "opened", issue: { number: 7, body: source, user: { type: "Bot" } } });
  await receive("pull_request", { action: "edited", sender: { type: "Bot" }, pull_request: { number: 8, body: source } });
});

test("short issue text does not call any API", async () => {
  await receive("issues", { action: "opened", issue: { number: 7, body: "Hi" } });
});
