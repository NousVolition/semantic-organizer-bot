# Semantic Organizer Bot

A GitHub App that explores source documents for language and connections:
recurring ideas, unusual metaphors, shifts of meaning, and possible names for
concepts still forming. It offers possibilities and their limits, leaving the
direction and wording with the author. It does not edit source files.

## Discover language across repositories

To review one of your ideas directly, open an issue here titled `[Review idea]`
and include the wording, intended meaning, evidence and any claim left unproved.
The owner-only command works even when automatic text reviews are off. It can
offer grounded encouragement, optional stronger wording, and a confidence tag
with reasons and ways to strengthen or narrow the claim. For proposed word
roles, include the whole sentence and intended reading. This is a fallible
language review, separate from lambeq's diagram construction. It uses the API
and replies publicly; use public material only.

Explicit idea reviews use the configured comparison model by default
(`IDEA_MODEL` can override it), with a structured response and validated
confidence bands, reasons and exact input quotations selected from literal
source spans (up to 250 spans / 100,000 source characters). Larger inputs fail
explicitly rather than being silently cut. Incomplete or malformed
responses are not published. A validation failure permits one regeneration
with a fixed diagnostic; a second failure stops, as do refusals and API errors.
Diagnostics contain codes, not submitted text or model responses.
Each idea review explicitly names the original idea being assessed and classifies
its support. The code maps supported to High, partial to Medium (with a band),
missing or contradicted to Low, and unevaluated to Not assessed. Confidence in
finding an error must never become a High tag on the original incorrect claim.
This avoids letting a short freeform review treat
the author's hesitancy as evidence against a supplied derivation. Ordinary
opt-in text reviews retain their existing separate model setting.

The owner opens an issue in this bot repository with one of these exact titles:

- `[Discover language] preview` — read the first source batch and show its
  coverage without making an OpenAI request.
- `[Discover language]` — read the first batch and generate a language and
  connections report when API credits are available.
- `[Discover language] batch 2` — examine the next batch; subsequent batch
  numbers work the same way.
- `[Discover language] continue 123` — continue the complete-text scan recorded
  in issue #123, using exactly the same source commits and reading settings.
  A preview continues with its current batch for analysis; a completed analysis
  advances one batch. A changed configuration requires a new scan.
- `[Discover language] check support examples` — run 12 independent model
  checks of grounded encouragement, confidence scope, withheld proof, preserved
  language, reset versus recovery, and empty comparisons. These synthetic cases
  test the publication reviewer, not fresh discovery or formal proof.
- `[Discover language] check examples` — run a paid regression check against
  22 examples using pinned public excerpts in 22 independent bounded calls.
  These include the seven corrected comparisons, sound controls, withheld proof
  claims, negation traps and polynomial/exponential scope. Expected answers and
  targeted failure fields are not sent to the model. The report checks decisions,
  specific mistake locations and assertion stance. Only the owner can run it.
- `[Discover language] check count examples` — evaluate 12 separate count-scope
  controls, including vocabulary totals versus exact-word counts, overlapping
  subsets, source coverage, attribution, changed versions and missing evidence.
  This owner-only command uses the configured comparison model and API usage.
  It does not scan repositories or change the existing 14- and 22-case suites.
- `[Discover language] review report 45` — apply the current evidence review to
  an existing completed bot report in issue #45. It rechecks the published claims
  and each term/fit using the exact public source commits originally cited, with
  the configured sampling budget. Citation text must match before a paid review
  runs. It reports individual verdicts without changing the original report or
  generating replacement findings. Sections already marked with a dated
  correction are skipped. The owner-only command uses one independent model call per finding
  for up to three saved findings and shares the discovery concurrency limit.

Start a new complete-text scan with a preview, then use the continuation title
shown in each report. Older sampled batch numbers do not describe this new index.

The report appears as a bot comment on that issue. Connections are labeled
**observed**, **interpretive**, or **creative**. Each published connection needs
two exact quotations from distinct source files. The model selects numbered
source passages; the code copies their original text and builds links to the
corresponding commit and line. Unknown passages and same-file-only evidence are
rejected. A strict response schema constrains relationship labels and limits
citations to the available passage IDs, with one citation slot per source file.
Each connection must select at least two different files. Citation matching
verifies the cited text. A separate high-reasoning model call for each connection reviews the whole proposed
comparison against all collected context for its cited files, checking study
provenance, construction/version, quantitative comparability and claim scope.
Each comparison is reviewed alone so a nearby corrected example cannot replace its claims.
Each new connection also carries **High**, **Medium (lower/middle/upper)**,
**Low**, or **Not assessed** confidence in the idea as stated, with its evidence
basis, an optional way to strengthen it, and any needed narrowing. These are
qualitative model judgments, not probabilities or grades of the author. The
confidence explanation is checked by the publication reviewer along with the
other fields. Low support may mean an untested creative possibility, not a false
or worthless idea. Missing assessments are never invented as high confidence.
Understatement checks can offer firmer wording for a demonstrated narrow result
while retaining deliberate modesty, unusual language and withheld proof claims.
The review first records a proposition and assertion stance (asserted, withheld,
conditional, attributed, contrast or mixed) for each field. It then gives a separate verdict and reason for the title,
relationship, limitation and every suggested term with its explanation. A true
relationship cannot override a failed or missing field-level check.
Selected-citation support is checked separately from broader context. A selected
result statement and its supplied adjacent derivation may jointly support details
of the same construction; the reviewer records the supporting passage IDs. An
unrelated selected quote still requires citation repair. Short topic headings are
read in the context of the complete connection, while explicit unsupported
assertions still block publication. Each review's citation schema is restricted
to that candidate's source files.
The rules distinguish retained plans from unsaved states, archive restoration
from reruns, structural agreement from chronology, and a polynomial exponent
from an exponential envelope. A word such as “proof” used as the stronger status
explicitly withheld is preserved; negation is not a blanket exemption for a
mixed sentence's unsupported affirmative claims.
Every check must pass with valid evidence references; failed, uncertain or
missing reviews withhold that proposal. An incomplete/refused review fails the
report closed. The report states the number withheld. This fallible model review
is not a proof checker and may still miss mistakes. Suggested coinages are
explicitly labeled. Refused or incomplete model responses are not published as
findings. Service logs record input/output token counts without source text or
credentials, so actual API usage can be checked after a run. Validation logs
record acceptance counts and rejection categories without storing generated
prose or source passages.

Discovery defaults to `gpt-5.4-mini` with medium reasoning and a 12,000-token
completion limit (including reasoning). `DISCOVERY_MODEL` overrides this;
an existing `OPENAI_MODEL` setting is also respected. Optional short reviews
retain their separate `OPENAI_MODEL` default. A discovery run uses one draft
call and one independent review call per proposed connection (at most three).
When discovery uses `gpt-5.4-mini`, the separate comparison review uses `gpt-5.4`.
`COMPARISON_MODEL` overrides only this checking model; otherwise a custom discovery
model is also used for checking. GPT-5.4 and GPT-5.4-mini reviews use medium
reasoning and a 12,000-token completion cap (including reasoning).
Discovery and comparison reviews have no application-level repair loop. The review adds
API cost; actual usage depends on source length and output. All calls log
token counts separately without source text. See the usage logs and
[discovery pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
and [comparison-review pricing](https://developers.openai.com/api/docs/models/gpt-5.4).
The 22-case regression check makes 22 paid review calls and reports the model used.

[discovery-config.json](discovery-config.json) selects the owner, reporting
repository, source repositories, priority paths, and bounded batch sizes. The
initial sources are the public `My-Sources-Project-ALL` and `Nous-Volition`
research repositories. The public reporting setup refuses private sources.
Private research needs separate access approval and a private reporting setup.

The default `readingMode: complete` indexes Markdown, plain text,
reStructuredText and TeX, including research text in archive, data, results and
analysis directories. It retains credential, dependency, Git metadata, binary
and size exclusions. Files are capped at 1 MB; an index above 2,000 eligible
files or 50 MB fails explicitly instead of silently truncating. Invalid UTF-8,
empty files and excluded formats are counted in coverage. Identical blob copies
are deduplicated, so they never masquerade as independent evidence.

Every character of readable eligible text is assigned to overlapping sections
of up to 6,000 characters. A batch selects up to 16 sections interleaved across
documents; a tail batch may repeat one other-file section for comparison context.
Original line locations and character ranges are retained. Continuations pin
the source commits and settings in the preceding bot report; they survive a
service restart. A numbered batch opened directly starts from current snapshots
and is not a continuation. Previews collect text without an OpenAI call.
Unchanged public blobs are cached in memory by repository and immutable blob ID
(up to 32 MiB of text / 2,000 entries). Current repository visibility is still
checked before cache use. A restart clears the cache, not the recorded snapshots.

Coverage means text made available in those batches, not a guarantee that the
model catches every issue. Connections are compared within a batch, not across
every possible pair of documents. PDF, Word, image, private-repository and live
Miro ingestion are not enabled. Board lessons were incorporated into shared
rules; the service does not independently synchronize the board. The optional
`readingMode: sampled` retains the earlier sampled collector for bounded previews.
Saved findings from either mode can be rechecked against their original context.

### Optional local Drift Scan

Set `ENABLE_DRIFT_SCAN=true` to add a local, opt-in shortlist to ordinary
`[Discover language]` and numbered batch runs. It loads
[`onnx-community/all-MiniLM-L6-v2-ONNX`](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX)
through Transformers.js, embeds the already collected citable passages in the
service process, and proposes a small set of cross-file pairs with middling
semantic similarity. It skips same-file pairs, exact repeated quotations, and
near-duplicate matches. The first enabled run in a fresh service instance may
download the public model and take longer.

Drift Scan is a routing aid, not a finding. It supplies only existing passage
IDs and rounded scores to the existing discovery prompt; it does not add source
text, create a report section, or call a Hugging Face inference API with source
passages. The normal exact-quotation checks, two-distinct-file rule, and
independent comparison review still decide what can be published. A score is not
evidence, a confidence value, or a demonstrated shared mechanism. Previews,
example checks, and report reviews never load the model. If the optional model
cannot load or run, discovery continues without a shortlist and logs only a
small diagnostic.

Only the configured owner's new issues in the reporting repository can trigger
discovery. One job runs per service instance. The webhook records a status
comment and returns before the scan finishes. A completed or recorded job is not
repeated by webhook redelivery. Jobs execute in the web process: a restart can
interrupt one, leaving its status comment unfinished. Open a new discovery issue
to retry after correcting the problem. There is no unattended recurring scan.

## Run HermiT or lambeq

Use [New issue](../../issues/new/choose) and choose **Check an ontology with
HermiT** or **Diagram word roles with lambeq**. These commands accept new issues
opened by `NousVolition` in this bot repository. Keep the exact template title.

- `[Check ontology]`: replace the body with one self-contained OWL ontology in
  RDF/XML (plain XML or one `xml` code block). The included example declares
  Motif a subclass of Pattern. HermiT checks consistency and lists unsatisfiable
  named classes. It cannot turn ordinary prose into verified axioms. External
  imports and XML entities are rejected. Limit: 48,000 bytes and 5,000 triples.
- `[Diagram word roles]`: supply a JSON object with exactly `subject`, `verb`
  and `object`, each a word or phrase up to 60 characters. Example:
  `{"subject":"Patterns","verb":"connect","object":"ideas"}`. lambeq builds
  a real subject-verb-object string diagram from those explicit assignments.
  It does not choose or verify the roles. No quantum circuit or semantic
  comparison is executed. The JSON may be placed in one `json` code block.
  The report tags assignment correctness **Not assessed**, explaining what
  context would be needed to assess the roles. A completed HermiT result is
  scoped to the supplied axioms; their real-world truth remains **Not assessed**.

**Automatic sentence parsing is currently unavailable.** The Bobcat model
download host does not resolve, and no verified working official replacement
was found. See [upstream issue 257](https://github.com/Quantinuum/lambeq/issues/257).
The installed lambeq diagram engine works without those pretrained weights.
There is no silent fallback from automatic parsing to a manually typed diagram.
Restoring Bobcat requires a trustworthy complete model and a successful real
parse test before exposing an automatic-parsing command.

A `github-actions[bot]` comment reports the actual result and links to the
run. The **language-tool-result** download contains JSON, diagnostics, the
input hash and (for lambeq) an SVG diagram. Downloads expire after seven days;
the comment remains. Failures and timeouts are reported as incomplete checks.
To check revised input, open a new issue; editing an old issue does not rerun it.

The tools install on disposable GitHub Actions runners, with dependencies
pinned in `tools/requirements-*.txt` and the shared setup action. They do not
run inside the Render web service. They use no OpenAI API credits and add no
Render service. GitHub Actions usage is subject to the account's runner and
billing settings. Each tool process has a four-minute limit; installation
can make a first run take several minutes. HermiT uses Java 17
and the build distributed with Owlready2 0.51; lambeq uses version 0.5.0. Runtime
metadata is recorded with each result. CI executes real consistent,
inconsistent and unsatisfiable-class ontology checks and a real lambeq diagram.

The plain-English rulebook guides model interpretation. These tool commands
are separate, explicit executions; adding a tool name to that file does not
install or invoke it. Discovery still finds words and connections without
requiring a writing error. Both tools remain advisory and leave source files
unchanged.

Implementation references: [Owlready2 reasoning](https://owlready2.readthedocs.io/en/latest/reasoning.html),
[lambeq sentence input](https://docs.quantinuum.com/lambeq/tutorials/sentence-input.html).

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
   - Optional, non-secret: `ENABLE_DRIFT_SCAN` = `true` to enable the local
     cross-file shortlist for normal discovery runs
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

### Corpus definitions

Edit `corpus-definitions.md` to maintain the owner's local terms and mathematical
distinctions. Both generation modes and the independent publication reviewer load
the same file at startup. A deployment loads changes. Keep definitions scoped to
their source/version; unfamiliar language is not itself an error. These rules
are prompt guidance, not model training or a formal verification tool.

The offline tests check prompt delivery and explicit mathematical counterexamples.
They do not measure live model accuracy. `fixtures/corpus-examples.json` contains
paired evaluation cases, separate from the guidance; expected verdicts must never
be sent to the model. No source document is uploaded by these tests.

The owner can request `[Discover language] check corpus examples` in the control
repository for the separate 14-case live model evaluation. This uses the configured
comparison model and API usage; it does not run on startup or on ordinary tests.
The existing `check examples` command retains its original 22-case scope.

The separate `check count examples` command uses `fixtures/count-examples.json`.
Its 12 controlled cases include the checked 46 broader vocabulary occurrences
versus 21 occurrences of “Left,” plus contrasting invented versions and incomplete
inputs. The cases are paraphrases and synthetic probes, not manuscript quotations.
Generation and review receive the counting rules and source-specific ledger in
`corpus-definitions.md`; a different source/version must use its own evidence.
Offline tests validate delivery, arithmetic, command routing and fail-closed
publication gates using supplied verdicts. They do not establish live model
comprehension or guarantee future counts.

The corpus suite includes the checked initial-field derivation and paired cases
that distinguish its proved properties from a withheld global-evolution claim.
It includes a negative control for downgrading the initial-field proof merely
because that stronger claim is withheld. The source/version and assumptions are recorded in the shared
definitions; these remain fallible model guidance, not a formal proof checker.

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
