# Semantic Organizer Bot

A GitHub App that reviews your projects in the background and on pull requests/issues. It looks for:

- Vague or unclear language (and rewrites it clearly)
- Words, math, or logic that look inaccurate or weak
- Better ways to explain the ideas
- Lateral connections (related concepts)

It posts the findings as comments or new issues.

## Easiest way to turn it on (Render)

1. Go to **https://render.com** and sign up (free) — you can use your GitHub account.
2. Click **New** → **Blueprint**.
3. Connect your GitHub account if asked, then choose the repo **semantic-organizer-bot**.
4. Render will detect the config. Click **Apply**.
5. On the service page, go to **Environment** and add these private variables (paste your values):
   - `OPENAI_API_KEY` = your new OpenAI key
   - `APP_ID` = from your GitHub App settings
   - `PRIVATE_KEY` = the full private key text from your GitHub App
   - `WEBHOOK_SECRET` = the secret you set when creating the GitHub App
6. After it deploys, copy the service URL (ends in `.onrender.com`) and set it as the Webhook URL in your GitHub App settings.

## Permissions for the GitHub App

- Issues: Read & write
- Pull requests: Read & write
- Contents: Read
- Metadata: Read

Subscribe to: `push`, `pull_request`, `issues`

## License
MIT
