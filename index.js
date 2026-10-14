/**
 * Semantic Organizer Bot
 *
 * Rewrites vague language in pull requests (and issues) into clear,
 * intelligible, academic-sounding but simple text using an LLM.
 *
 * Requires OPENAI_API_KEY in .env
 */

const OpenAI = require("openai");

module.exports = (app) => {
  app.log.info("Semantic Organizer Bot is loaded!");

  // Initialize OpenAI client if key is present
  let openai = null;
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    app.log.info("OpenAI client ready");
  } else {
    app.log.warn("OPENAI_API_KEY not set — rewriting disabled");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  /**
   * Rewrite text to be clear, academic-sounding, but simple.
   */
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
          {
            role: "user",
            content: text.trim(),
          },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (err) {
      app.log.error("LLM rewrite failed:", err.message);
      return null;
    }
  }

  // When a pull request is opened or updated
  app.on(["pull_request.opened", "pull_request.edited", "pull_request.synchronize"], async (context) => {
    const pr = context.payload.pull_request;
    const body = pr.body || "";
    const title = pr.title || "";

    if (!openai) {
      await context.octokit.issues.createComment(
        context.issue({
          body: "🤖 Semantic Organizer is installed but `OPENAI_API_KEY` is not set, so rewriting is disabled.",
        })
      );
      return;
    }

    // Combine title + body for context, but focus rewrite on the body
    const source = body.trim() || title;
    if (source.length < 15) return;

    app.log.info(`Rewriting PR #${pr.number} in ${context.repo().owner}/${context.repo().repo}`);

    const rewritten = await rewriteVagueLanguage(source);
    if (!rewritten || rewritten === source) return;

    const commentBody = `### 🤖 Semantic rewrite suggestion\n\nI rewrote the description to be clearer, more precise (academic tone), and still simple:\n\n---\n\n${rewritten}\n\n---\n\n*Original meaning preserved. You can copy the version above or ask me to adjust it.*`;

    await context.octokit.issues.createComment(context.issue({ body: commentBody }));
  });

  // Also handle new issues
  app.on("issues.opened", async (context) => {
    if (!openai) return;

    const issue = context.payload.issue;
    const body = issue.body || "";
    if (body.trim().length < 20) return;

    app.log.info(`Rewriting issue #${issue.number}`);

    const rewritten = await rewriteVagueLanguage(body);
    if (!rewritten || rewritten === body) return;

    const commentBody = `### 🤖 Clearer version of this issue\n\nRewritten for clarity, academic precision, and simplicity:\n\n---\n\n${rewritten}\n\n---`;

    await context.octokit.issues.createComment(context.issue({ body: commentBody }));
  });

  app.onError(async (error) => {
    app.log.error(error);
  });
};
