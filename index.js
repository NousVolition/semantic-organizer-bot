/**
 * Semantic Organizer Bot
 *
 * 1. Rewrites vague language into clear, academic-but-simple text.
 * 2. Scans for inaccurate words, math, or logic.
 * 3. Suggests better explanations.
 * 4. Points out lateral connections (related ideas that should be linked).
 *
 * Works on pull requests, issues, and also in the background on pushes.
 * Requires OPENAI_API_KEY in .env
 */

const OpenAI = require("openai");

module.exports = (app) => {
  app.log.info("Semantic Organizer Bot is loaded!");

  let openai = null;
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    app.log.info("OpenAI client ready");
  } else {
    app.log.warn("OPENAI_API_KEY not set — analysis disabled");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  async function rewriteVagueLanguage(text) {
    if (!openai || !text || text.trim().length < 20) return null;
    try {
      const response = await openai.chat.completions.create({
        model,
        temperature: 0.4,
        max_tokens: 800,
        messages: [
          {
            role: "system",
            content: `You are a careful editor. Rewrite the user's text so it is:\n- Clear and intelligible\n- Academic in tone (precise, formal, well-structured)\n- Still simple and accessible (avoid unnecessary jargon, explain ideas plainly)\n\nPreserve the original meaning. Do not add new claims. Keep it concise.\nIf the text is already clear, improve it only lightly.\nReturn only the rewritten text, nothing else.`,
          },
          { role: "user", content: text.trim() },
        ],
      });
      return response.choices[0]?.message?.content?.trim() || null;
    } catch (err) {
      app.log.error("LLM rewrite failed:", err.message);
      return null;
    }
  }

  async function analyzeSemantics(text) {
    if (!openai || !text || text.trim().length < 30) return null;
    try {
      const response = await openai.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: `You are a careful reviewer focused on accuracy and clarity.\n\nReview the text and respond in this exact structure:\n\n### Possible inaccuracies or weak logic\n- List any words, math, claims, or reasoning that look inaccurate, unsupported, or unclear. If none, say "None noted."\n\n### Clearer explanations\n- Suggest a simpler or more precise way to say the main points. Keep the tone academic but accessible.\n\n### Lateral connections\n- Point out related ideas, concepts, or topics that this text connects to (even if not explicitly mentioned). If none stand out, say "None noted."\n\nBe concise. Do not invent facts. If the text is short or already solid, keep the response brief.`,
          },
          { role: "user", content: text.trim() },
        ],
      });
      return response.choices[0]?.message?.content?.trim() || null;
    } catch (err) {
      app.log.error("Semantic analysis failed:", err.message);
      return null;
    }
  }

  // Background scanning on pushes (no PR needed)
  app.on("push", async (context) => {
    if (!openai) return;
    if (context.payload.ref !== "refs/heads/main") return;

    const commits = context.payload.commits || [];
    const messages = commits.map(c => c.message).filter(Boolean).join("\n\n");
    if (!messages.trim()) return;

    app.log.info(`Background scan on push to main in ${context.repo().owner}/${context.repo().repo}`);

    const analysis = await analyzeSemantics(messages);
    if (!analysis) return;

    // Open a new issue with the findings so they stay visible
    await context.octokit.issues.create({
      owner: context.repo().owner,
      repo: context.repo().repo,
      title: "🤖 Semantic review from recent changes",
      body: `Background scan of recent commit messages:\n\n${analysis}\n\n---\n*This was generated automatically when code was pushed to main.*`,
      labels: ["semantic-review"],
    });
  });

  // Pull requests (still supported)
  app.on(["pull_request.opened", "pull_request.edited", "pull_request.synchronize"], async (context) => {
    const pr = context.payload.pull_request;
    const body = pr.body || "";
    const title = pr.title || "";
    const source = (title + "\n\n" + body).trim();

    if (!openai) {
      await context.octokit.issues.createComment(
        context.issue({ body: "🤖 Semantic Organizer is installed but `OPENAI_API_KEY` is not set." })
      );
      return;
    }

    if (source.length < 20) return;

    app.log.info(`Analyzing PR #${pr.number}`);

    const rewritten = await rewriteVagueLanguage(body || title);
    if (rewritten && rewritten !== (body || title)) {
      await context.octokit.issues.createComment(
        context.issue({
          body: `### 🤖 Clearer rewrite\n\n---\n${rewritten}\n---`,
        })
      );
    }

    const analysis = await analyzeSemantics(source);
    if (analysis) {
      await context.octokit.issues.createComment(
        context.issue({
          body: `### 🤖 Semantic review\n\n${analysis}`,
        })
      );
    }
  });

  // Issues
  app.on("issues.opened", async (context) => {
    if (!openai) return;

    const issue = context.payload.issue;
    const body = issue.body || "";
    if (body.trim().length < 30) return;

    app.log.info(`Analyzing issue #${issue.number}`);

    const rewritten = await rewriteVagueLanguage(body);
    if (rewritten && rewritten !== body) {
      await context.octokit.issues.createComment(
        context.issue({
          body: `### 🤖 Clearer rewrite\n\n---\n${rewritten}\n---`,
        })
      );
    }

    const analysis = await analyzeSemantics(body);
    if (analysis) {
      await context.octokit.issues.createComment(
        context.issue({
          body: `### 🤖 Semantic review\n\n${analysis}`,
        })
      );
    }
  });

  app.onError(async (error) => {
    app.log.error(error);
  });
};
