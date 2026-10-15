# Semantic Organizer Bot

A GitHub App that reviews your projects in the background and on pull requests/issues. It looks for:

- Vague or unclear language (and rewrites it clearly)
- Words, math, or logic that look inaccurate or weak
- Better ways to explain the ideas
- Lateral connections (related concepts)

It posts the findings as comments or new issues. It analyzes issue and PR text,
and commit messages pushed to each repository's default branch. It does not
currently read or rewrite repository files.

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
9. Open an issue with a few sentences of text in an installed repository. Check for the bot's comments and inspect Render's logs if none appear.

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
