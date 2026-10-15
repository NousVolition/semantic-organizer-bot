/**
 * Semantic Organizer Bot — Language Skill
 *
 * Built for smart, organized, busy people who like language and exploring ideas with ease.
 *
 * - Improves clarity and precision without extra work
 * - Surfaces interesting lateral connections
 * - Flags weak or inaccurate language/logic
 * - Runs in the background and on PRs/issues
 *
 * Requires OPENAI_API_KEY
 */

const OpenAI = require("openai");

module.exports = (app, { getRouter } = {}) => {
  app.log.info("Semantic Organizer Bot (Language Skill) is loaded!");

  let openai = null;
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    app.log.info("OpenAI client ready");
  } else {
    app.log.warn("OPENAI_API_KEY not set — language skill disabled");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (getRouter) {
    const router = getRouter();
    router.get("/healthz", (_req, res) => {
      res.status(openai ? 200 : 503).json({ status: openai ? "ok" : "unconfigured" });
    });
    router.get("/", (_req, res) => {
      res.type("text").send("Semantic Organizer Bot. Health: /healthz. GitHub webhook: /api/github/webhooks.");
    });
  }

  async function improveLanguage(text) {
    if (!openai || !text || text.trim().length < 20) return null;
    try {
      const response = await openai.chat.completions.create({
        model,
        temperature: 0.35,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: `You are a precise, calm editor for busy, thoughtful people.\n\nRewrite the text so it is:\n- Clear and easy to read\n- Precise and well-structured (academic clarity without heaviness)\n- Simple where possible, elegant where it helps\n- Unchanged in meaning\n\nReturn only the improved version.`,
          },
          { role: "user", content: text.trim() },
        ],
      });
      return response.choices[0]?.message?.content?.trim() || null;
    } catch (err) {
      app.log.error("Language improvement failed:", err.message);
      return null;
    }
  }

  async function exploreLanguage(text) {
    if (!openai || !text || text.trim().length < 30) return null;
    try {
      const response = await openai.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: `You help smart, organized people explore language and ideas with ease.\n\nRespond in this structure:\n\n### Precision notes\n- Any words, claims, or logic that could be tighter, more accurate, or clearer. If none: "Looks solid."\n\n### Clearer phrasing\n- One or two short suggestions that make the main idea easier to grasp.\n\n### Connections worth exploring\n- Lateral links to related ideas, fields, or questions this text naturally touches. Keep it light and interesting. If none: "None stand out."\n\nBe concise. Prefer insight over volume.`,
          },
          { role: "user", content: text.trim() },
        ],
      });
      return response.choices[0]?.message?.content?.trim() || null;
    } catch (err) {
      app.log.error("Language exploration failed:", err.message);
      return null;
    }
  }

  // Background scan on push
  app.on("push", async (context) => {
    const defaultBranch = context.payload.repository.default_branch;
    if (!openai || !defaultBranch || context.payload.deleted || context.payload.ref !== `refs/heads/${defaultBranch}`) return;

    const messages = (context.payload.commits || [])
      .map(c => c.message)
      .filter(Boolean)
      .join("\n\n");
    if (!messages.trim()) return;

    app.log.info(`Language skill scanning push in ${context.repo().owner}/${context.repo().repo}`);

    const exploration = await exploreLanguage(messages);
    if (!exploration) return;

    await context.octokit.issues.create({
      owner: context.repo().owner,
      repo: context.repo().repo,
      title: "Language notes from recent changes",
      body: `${exploration}\n\n---\n*Generated automatically on push to the default branch.*`,
      labels: ["language"],
    });
  });

  // Pull requests
  app.on(["pull_request.opened", "pull_request.edited", "pull_request.synchronize"], async (context) => {
    if (!openai || context.payload.sender?.type === "Bot") return;

    const pr = context.payload.pull_request;
    const source = `${pr.title || ""}\n\n${pr.body || ""}`.trim();
    if (source.length < 20) return;

    app.log.info(`Language skill on PR #${pr.number}`);

    const improved = await improveLanguage(pr.body || pr.title);
    if (improved && improved !== (pr.body || pr.title)) {
      await context.octokit.issues.createComment(
        context.issue({ body: `### Clearer version\n\n---\n${improved}\n---` })
      );
    }

    const exploration = await exploreLanguage(source);
    if (exploration) {
      await context.octokit.issues.createComment(
        context.issue({ body: `### Language notes\n\n${exploration}` })
      );
    }
  });

  // Issues
  app.on("issues.opened", async (context) => {
    if (!openai || context.payload.sender?.type === "Bot" || context.payload.issue.user?.type === "Bot") return;

    const body = context.payload.issue.body || "";
    if (body.trim().length < 30) return;

    app.log.info(`Language skill on issue #${context.payload.issue.number}`);

    const improved = await improveLanguage(body);
    if (improved && improved !== body) {
      await context.octokit.issues.createComment(
        context.issue({ body: `### Clearer version\n\n---\n${improved}\n---` })
      );
    }

    const exploration = await exploreLanguage(body);
    if (exploration) {
      await context.octokit.issues.createComment(
        context.issue({ body: `### Language notes\n\n${exploration}` })
      );
    }
  });

  app.onError(async (error) => {
    app.log.error(error);
  });
};
