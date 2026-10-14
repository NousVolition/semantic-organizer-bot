# Semantic Organizer Bot

A GitHub App that reviews pull requests and issues for:

- Vague or unclear language (rewrites it to be clear, academic-sounding, but still simple)
- Words, math, or logic that look inaccurate or weak
- Better ways to explain the ideas
- Lateral connections (related concepts that should be linked)

It posts comments with the suggestions so you can review and use them.

## What it does

On new or updated pull requests and new issues, the bot:

1. Offers a clearer rewrite of the description
2. Flags possible inaccuracies or weak reasoning
3. Suggests simpler or more precise explanations
4. Points out related ideas or lateral connections

## Setup

The bot needs an OpenAI API key to work. Do **not** put the key in the GitHub files if the repo is public.

When you run or deploy the bot, set the environment variable `OPENAI_API_KEY` to your key.

Other required settings (from GitHub App registration): `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`.

## Permissions

When installing the GitHub App, give it:
- Issues: Read & write
- Pull requests: Read & write
- Metadata: Read

## License
MIT
