# Semantic Organizer Bot

A GitHub App that explores source documents for language and connections:
recurring ideas, unusual metaphors, shifts of meaning, and possible names for
concepts still forming. It offers possibilities and their limits, leaving the
direction and wording with the author. It does not edit source files.

## Discover language across repositories

The owner opens an issue in this bot repository with one of these exact titles:

- `[Discover language] preview` — read the first source batch and show its
  coverage without making an OpenAI request.
- `[Discover language]` — read the first batch and generate a language and
  connections report when API credits are available.
- `[Discover language] batch 2` — examine the next batch; subsequent batch
  numbers work the same way.

The report appears as a bot comment on that issue. Connections are labeled
**observed**, **interpretive**, or **creative**. Each published connection needs
two exact quotations from distinct source files. The model selects numbered
source passages; the code copies their original text and builds links to the
corresponding commit and line. Unknown passages and same-file-only evidence are
rejected. A strict response schema constrains relationship labels and limits
citations to the available passage IDs, with one citation slot per source file.
Each connection must select at least two different files. These checks
verify the cited text, not the model's interpretation. Suggested coinages are
explicitly labeled. Refused or incomplete model responses are not published as
findings. Service logs record input/output token counts without source text or
credentials, so actual API usage can be checked after a run. Validation logs
record acceptance counts and rejection categories without storing generated
prose or source passages.

Discovery defaults to `gpt-5.4-mini` with medium reasoning and a 6,000-token
completion limit (including reasoning). `DISCOVERY_MODEL` overrides this;
an existing `OPENAI_MODEL` setting is also respected. Optional short reviews
retain their separate `OPENAI_MODEL` default. Each discovery run makes one
model call. At the published GPT-5.4 mini rates of $0.75 per million input
tokens and $4.50 per million output tokens, a 23,000-input-token batch with
the full 6,000-token completion allowance costs about $0.044 before taxes.
Actual usage varies; see the safe usage logs and
[current model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

[discovery-config.json](discovery-config.json) selects the owner, reporting
repository, source repositories, priority paths, and bounded batch sizes. The
initial sources are the public `My-Sources-Project-ALL` and `Nous-Volition`
research repositories. The public reporting setup refuses private sources.
Private research needs separate access approval and a private reporting setup.

The collector indexes Markdown, plain text, reStructuredText and TeX paths on
each repository's default branch. It excludes archives, common generated-data
directories, credential paths, binaries, and files over the size limit. Identical
file copies are counted once. Files are interleaved across repositories; each
batch covers up to 16 files. Long files contribute up to 6,000 characters from
several positions, with original line numbers. Reports state the selection and
sampling; a batch is not an exhaustive reading of the account. Batch membership
can change when source commits change. It does not search PDFs, images, issues,
or every line of long documents.

Only the configured owner's new issues in the reporting repository can trigger
discovery. One job runs per service instance. The webhook records a status
comment and returns before the scan finishes. A completed or recorded job is not
repeated by webhook redelivery. Jobs execute in the web process: a restart can
interrupt one, leaving its status comment unfinished. Open a new discovery issue
to retry after correcting the problem. There is no unattended recurring scan.

## Optional short reviews

Ordinary issue/PR text reviews are off by default. Set `ENABLE_TEXT_REVIEWS=true`
in Render to enable one suggestion comment on a new issue or an opened, edited,
or synchronized PR. Bot-created items are ignored; repeated PR events can produce
another review comment.
Automatic issues after pushes are **off by default**. To opt in, set
`ENABLE_PUSH_REVIEWS=true` in Render; this reviews commit messages on the
repository's default branch, not file contents.

## Program the language skills

Edit [language-skills.md](language-skills.md) in this bot's repository. It is a
plain-English rulebook: no JavaScript is needed for changing the writing rules.

1. Open the file in GitHub and click the pencil to edit it.
2. Add a rule, a glossary entry, or a before/after example with an explanation of
   the distinction you care about. Templates are included in the file.
3. Commit the change to `main` (or merge a PR). The connected Render service
   redeploys automatically and loads the file when the new version starts.
4. Open a discovery issue and check the language findings. If short reviews are
   enabled, a normal issue can also contain a word-choice question.

For example, a rule can say: "When several words fit, explain the difference in
meaning before suggesting one. Ask me for context if that difference matters."
An example can teach the bot why you prefer one phrase in a particular context;
it should not turn that preference into a universal correction.

The same rulebook applies to discovery and optional short reviews. The defaults
encourage unusual language, distinguish creative connections from observed ones,
quote source phrases, preserve the author's voice, and flag uncertainty. These are model
instructions, not guarantees of accuracy. It has no live dictionary or source
verification tool. A curated glossary gives it explicit local definitions; a
future dictionary integration would require JavaScript, a source, and tests.

For a new code capability, put its logic in a separate module, connect the
appropriate handler in `index.js`, and add mocked cases in `test/events.test.js`
before deploying. Keep API keys in Render, never in the skill file.

## Easiest way to turn it on (Render)

1. Go to **https://render.com** and sign in — you can use your GitHub account.
2. Click **New** → **Blueprint**.
3. Connect your GitHub account if asked, then choose the repo **semantic-organizer-bot**.
4. Render will detect the config. Click **Apply**.
5. On the service page, go to **Environment** and add these private variables (paste your values):
   - `OPENAI_API_KEY` = your new OpenAI key
   - `APP_ID` = the numeric App ID from your GitHub App settings (not the Client ID)
   - `PRIVATE_KEY` = the full private key text from your GitHub App
   - `WEBHOOK_SECRET` = the secret you set when creating the GitHub App
6. After it deploys, open `https://YOUR-SERVICE.onrender.com/healthz`. It should return `{"status":"ok"}`. This confirms that the app loaded and has its required settings; it does not test the credentials against GitHub or OpenAI.
7. Set the GitHub App's **Webhook URL** to `https://YOUR-SERVICE.onrender.com/api/github/webhooks`. The `/api/github/webhooks` path is required.
8. Install the GitHub App on the repositories you want it to review. In the app settings, open **Advanced → Recent Deliveries**, send or redeliver a `ping`, and verify a successful response.
9. As the configured owner, open `[Discover language] preview` in the configured reporting repository to verify source reading and comment posting. Then open `[Discover language]` to test generation when API credits are available.

For an existing Render service, use **Build Command** `npm ci --omit=dev`,
**Start Command** `npm start`, **Health Check Path** `/healthz`, and Node.js 24
(`NODE_VERSION=24`). Changes to `render.yaml` apply through a synced Blueprint;
manually created services need these settings updated in the dashboard.

The included Blueprint keeps the free plan. Render's free web services spin down
after inactivity, and cold starts can cause GitHub webhook timeouts. For reliable
always-on processing, choose a plan that stays running. After a timeout, wake the
service via `/healthz`, then redeliver the failed webhook in GitHub.

### Troubleshooting startup

- `appFn is not a function`: deploy the current code and use `npm start`. The old start command passed a string to Probot's programmatic API.
- `Missing required environment variables`: add the named settings in **Render → Environment**. The bot now exits with a clear error instead of serving a nonfunctional fallback page.
- `PRIVATE_KEY must contain the full RSA private key`: paste the entire GitHub App PEM, including its BEGIN/END lines. Both real line breaks and literal `\n` sequences are accepted. Do not add surrounding quotes in Render. For local use, `PRIVATE_KEY_PATH` can point to the PEM file instead.
- Webhook `404`: check the full webhook URL, including `/api/github/webhooks`.
- Webhook signature error: make `WEBHOOK_SECRET` match the GitHub App's secret exactly.
- OpenAI errors: check the API key, API billing/quota, and access to `OPENAI_MODEL` (default `gpt-4o-mini`). The API key belongs in Render, not in the GitHub repository.

Do not commit `.env` or private key files.

## Permissions for the GitHub App

- Issues: Read & write
- Pull requests: Read & write
- Contents: Read
- Metadata: Read

Subscribe to: `push`, `pull_request`, `issues`

## Local development and tests

Use Node.js 24. Run `npm ci`, copy `.env.example` to `.env`, and fill in the
settings. `npm start` validates the settings and starts the bot. `npm run dev`
uses Probot's interactive local setup instead.

Run `npm test` for startup, health check, webhook signature, and event-handler
tests. Tests use generated temporary keys and mocked OpenAI/GitHub responses;
they do not require real credentials or post to GitHub.

The **Bot tests** GitHub Actions workflow runs on pushes and pull requests.
Datadog monitoring is optional and is skipped with a notice unless both
`DD_API_KEY` and `DD_APP_KEY` are configured. Publishing templates are unrelated
to running this private application.

Deployment references: [Probot](https://probot.github.io/docs/deployment/),
[Render free service limits](https://render.com/docs/free), and
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini).

## License
MIT
