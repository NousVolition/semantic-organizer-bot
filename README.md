# Semantic Organizer Bot

A GitHub App (built with [Probot](https://probot.github.io/)) that rewrites **vague language** in pull requests and issues into clear, intelligible, academic-sounding but still simple text using an LLM.

It helps make descriptions, explanations, and notes easier to understand without losing meaning or becoming overly complicated.

## What it does

- When a pull request is opened, edited, or synchronized, the bot looks at the PR body.
- When an issue is opened, it looks at the issue body.
- It sends the text to an LLM (OpenAI) with a prompt that asks for a rewrite that is:
  - Clear and intelligible
  - Academic in tone (precise, formal, well-structured)
  - Still simple and accessible (plain language, limited jargon)
- It posts a comment with the rewritten version so you can copy it or use it as a suggestion.

## Setup

### 1. Clone and install
```bash
git clone https://github.com/NousVolition/semantic-organizer-bot.git
cd semantic-organizer-bot
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and fill in:

- `APP_ID`, `PRIVATE_KEY` (or `PRIVATE_KEY_PATH`), `WEBHOOK_SECRET` — from your GitHub App registration
- `OPENAI_API_KEY` — your OpenAI API key (required for rewriting)
- Optional: `OPENAI_MODEL=gpt-4o-mini` (or `gpt-4o`)

### 3. Run locally
```bash
npm start
```

Open http://localhost:3000 to register/install the GitHub App if you haven't already.

### Permissions needed
When registering the GitHub App, grant:
- Issues: Read & write
- Pull requests: Read & write
- Metadata: Read
- Contents: Read (optional, for future file scanning)

Subscribe to events: `pull_request`, `issues`

## Example

Vague PR body:
> this thing kinda fixes the weird bug where stuff sometimes doesn't work right when you click around

Rewritten suggestion:
> This change addresses an intermittent failure that occurs during user interaction with interactive elements. The underlying cause appears to be inconsistent state handling after certain click sequences.

## Deploy
Deploy to any Node host (Render, Railway, Fly.io, etc.). Set the same environment variables, including `OPENAI_API_KEY`.

## License
MIT
