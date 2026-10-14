# Semantic Organizer Bot

A GitHub App (built with [Probot](https://probot.github.io/)) that goes through your repositories and helps organize or update **semantics** — meaning, structure, documentation, summaries of what the code actually does.

This is an open-source starter so people can use it, fork it, and extend it.

## What it can do (starter)

- Listens for pull requests and comments with a note
- Logs activity
- Ready for you to add real semantic analysis (AST parsing, LLM calls, file reorganization suggestions, auto-updating docs, etc.)

## Ideas for "organizes or updates semantics"

- Parse code with tree-sitter or similar and extract function/class purposes from names + comments
- Generate / update a `SEMANTICS.md` or docs folder with high-level meaning of modules
- Suggest moving files into better semantic folders
- Auto-label issues/PRs by topic
- Call an AI API to rewrite comments or generate better names
- Keep a knowledge graph of concepts in the repo

## Quick start (local development)

1. Clone this repo:
   ```bash
   git clone https://github.com/NousVolition/semantic-organizer-bot.git
   cd semantic-organizer-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the app:
   ```bash
   npm start
   ```

4. Open http://localhost:3000 and click **Register a GitHub App**. Follow the prompts to create the app and install it on your repositories.

   This writes a `.env` file with the credentials.

5. Restart the server (`npm start`) and open a test pull request in a repo where the app is installed. You should see a comment from the bot.

## Manual setup (if the auto-register doesn't work)

1. Create a new GitHub App at https://github.com/settings/apps/new
2. Set webhook URL to a proxy like https://smee.io (or your deployed URL)
3. Give it permissions: Issues (write), Pull requests (write), Contents (read), Metadata (read)
4. Subscribe to events: Pull request, Push
5. Download the private key, put `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET` in a `.env` file
6. Use `npx smee-client -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/api/github/webhooks`

## Deploy

You can deploy to Render, Heroku, Railway, Fly.io, or any Node host. Set the same environment variables.

## License

MIT — use it, change it, share it.
