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
const originalPushReviews = process.env.ENABLE_PUSH_REVIEWS;
const originalTextReviews = process.env.ENABLE_TEXT_REVIEWS;
const originalDriftScan = process.env.ENABLE_DRIFT_SCAN;
beforeEach(async () => {
  unmatched = [];
  nock.emitter.on("no match", recordUnmatched);
  nock.disableNetConnect();
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.OPENAI_MODEL;
  delete process.env.ENABLE_PUSH_REVIEWS;
  delete process.env.ENABLE_DRIFT_SCAN;
  process.env.ENABLE_TEXT_REVIEWS = "true";
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
  if (originalPushReviews === undefined) delete process.env.ENABLE_PUSH_REVIEWS;
  else process.env.ENABLE_PUSH_REVIEWS = originalPushReviews;
  if (originalTextReviews === undefined) delete process.env.ENABLE_TEXT_REVIEWS;
  else process.env.ENABLE_TEXT_REVIEWS = originalTextReviews;
  if (originalDriftScan === undefined) delete process.env.ENABLE_DRIFT_SCAN;
  else process.env.ENABLE_DRIFT_SCAN = originalDriftScan;
  assert.deepEqual(pending, []);
  assert.deepEqual(unmatched, []);
});

const repository = { name: "demo", owner: { login: "example" }, default_branch: "develop" };
const source = "This explanation could be clearer and more precise for readers.";
function completion(output) {
  return nock("https://api.openai.com")
    .post("/v1/chat/completions", (body) => {
      assert.equal(body.model, "gpt-4o-mini");
      assert.match(body.messages[0].content, /Role: adviser, not decision-maker/);
      assert.match(body.messages[0].content, /Owner's glossary/);
      assert.match(body.messages[0].content, /\*\*Needs attention\*\*/);
      assert.match(body.messages[0].content, /If nothing needs attention in this direct review/);
      assert.doesNotMatch(body.messages[0].content, /### Discovery reports/);
      assert.match(body.messages[0].content, /no dictionary, browsing, or external verification tool/);
      assert.equal(body.messages.at(-1).role, "user");
      return body.messages.at(-1).content.includes(source);
    })
    .reply(200, { choices: [{ message: { content: output } }] });
}
function receive(name, payload) {
  return probot.receive({ id: `test-${name}`, name, payload: { repository, sender: { type: "User" }, ...payload } });
}

test("issues use the editable skills and produce one optional semantic review", async () => {
  completion("Consider precise rather than polished if you mean exact in meaning.");
  nock("https://api.github.com").post("/repos/example/demo/issues/7/comments", {
    body: "### Optional semantic suggestions\n\nConsider precise rather than polished if you mean exact in meaning.\n\n---\n*Suggestions only. Your wording and decisions remain yours.*",
  }).reply(201, { id: 1 });
  await receive("issues", { action: "opened", issue: { number: 7, body: source, user: { type: "User" } } });
});

test("pull requests produce comments on the correct PR", async () => {
  completion("A related idea.");
  nock("https://api.github.com").post("/repos/example/demo/issues/8/comments", (body) => body.body.includes("A related idea.")).reply(201, { id: 2 });
  await receive("pull_request", { action: "opened", pull_request: { number: 8, title: "Clarify documentation", body: source } });
});

test("push scanning follows the repository's actual default branch", async () => {
  process.env.ENABLE_PUSH_REVIEWS = "true";
  completion("Some language notes.");
  nock("https://api.github.com").post("/repos/example/demo/issues", (body) => {
    assert.equal(body.title, "Optional semantic notes from recent changes");
    assert.match(body.body, /Some language notes/);
    return true;
  }).reply(201, { number: 9 });
  await receive("push", { ref: "refs/heads/develop", commits: [{ message: source }] });
});

test("other branches, branch deletions, and empty pushes do not call any API", async () => {
  process.env.ENABLE_PUSH_REVIEWS = "true";
  await receive("push", { ref: "refs/heads/main", commits: [{ message: source }] });
  await receive("push", { ref: "refs/heads/develop", deleted: true, commits: [{ message: source }] });
  await receive("push", { ref: "refs/heads/develop", commits: [] });
});

test("push reviews are off by default so routine pushes do not create issues", async () => {
  await receive("push", { ref: "refs/heads/develop", commits: [{ message: source }] });
});

test("ordinary text reviews are off by default in discovery mode", async () => {
  delete process.env.ENABLE_TEXT_REVIEWS;
  await receive("issues", { action: "opened", issue: { number: 7, body: source } });
  await receive("pull_request", { action: "opened", pull_request: { number: 8, body: source } });
});

test("a word-choice question in an issue title can be reviewed without a body", async () => {
  const title = "Should this feature be called precise or polished?";
  nock("https://api.openai.com").post("/v1/chat/completions", (body) => body.messages.at(-1).content === title)
    .reply(200, { choices: [{ message: { content: "Which property matters: exactness or presentation?" } }] });
  nock("https://api.github.com").post("/repos/example/demo/issues/7/comments", (body) => body.body.includes("Which property matters"))
    .reply(201, { id: 1 });
  await receive("issues", { action: "opened", issue: { number: 7, title, body: null, user: { type: "User" } } });
});

test('owner-requested idea reviews work with automatic reviews disabled and receive confidence rules', async () => {
  delete process.env.ENABLE_TEXT_REVIEWS;
  nock('https://api.openai.com').post('/v1/chat/completions', body => {
    assert.match(body.messages[0].content, /Understatement and grounded encouragement/);
    assert.match(body.messages[0].content, /Medium: there is relevant support/);
    assert.match(body.messages[0].content, /not a calibrated probability/);
    return body.messages.at(-1).content.includes(source);
  }).reply(200, {choices:[{message:{content:'Confidence: medium (middle). Here is the evidence boundary.'}}]});
  nock('https://api.github.com').post('/repos/NousVolition/semantic-organizer-bot/issues/7/comments', b => b.body.includes('Confidence: medium')).reply(201,{id:1});
  await receive('issues',{action:'opened',sender:{type:'User',login:'NousVolition'},repository:{name:'semantic-organizer-bot',owner:{login:'NousVolition'}},issue:{number:7,title:'[Review idea]',body:source,user:{type:'User'}}});
});

test('other users and repositories cannot trigger the explicit idea command', async () => {
  for (const [login, name] of [['other','semantic-organizer-bot'],['NousVolition','other']])
    await receive('issues',{action:'opened',sender:{type:'User',login},repository:{name,owner:{login:'NousVolition'}},issue:{number:7,title:'[Review idea]',body:source,user:{type:'User'}}});
});

test("the bot ignores its own generated issues and other bot events", async () => {
  await receive("issues", { action: "opened", issue: { number: 7, body: source, user: { type: "Bot" } } });
  await receive("pull_request", { action: "edited", sender: { type: "Bot" }, pull_request: { number: 8, body: source } });
});

test("short issue text does not call any API", async () => {
  await receive("issues", { action: "opened", issue: { number: 7, body: "Hi" } });
});

test("explicit tool commands do not also spend OpenAI credits on a text review", async () => {
  for (const title of ["[Check ontology]", "[Diagram word roles]", "[Diagram sentence]"]) {
    await receive("issues", { action: "opened", issue: { number: 7, title, body: source, user: { type: "User" } } });
  }
});

test("OpenAI failures retain diagnostic codes without logging credentials or submitted text", async (t) => {
  const logged = [];
  t.mock.method(probot.log, "error", (...args) => logged.push(args));
  nock("https://api.openai.com").post("/v1/chat/completions").reply(401, {
    error: {
      message: `Incorrect API key: test-credential-marker. Submitted text: ${source}`,
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  });
  await receive("issues", { action: "opened", issue: { number: 7, body: source, user: { type: "User" } } });
  assert.equal(logged.length, 1);
  for (const [details, message] of logged) {
    assert.deepEqual(details, { provider: "openai", status: 401, code: "invalid_api_key", type: "invalid_request_error" });
    assert.equal(message, "Semantic review failed");
  }
  assert.doesNotMatch(JSON.stringify(logged), /test-credential-marker/);
  assert.ok(!JSON.stringify(logged).includes(source));
});


