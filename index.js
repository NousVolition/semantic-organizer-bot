/**
 * Semantic Organizer Bot
 * 
 * A Probot GitHub App that can analyze repositories and organize or update semantic information.
 * 
 * Ideas for expansion:
 * - On push/PR: analyze changed files for functions, classes, comments
 * - Generate or update a SEMANTICS.md with summaries of what code does
 * - Suggest file organization based on semantic groups
 * - Use an LLM API to extract meaning and update docs/comments
 * - Organize issues/PRs by topic
 *
 * This is a starter. Install on your repos and extend the logic.
 */

module.exports = (app) => {
  // Log when the app loads
  app.log.info("Semantic Organizer Bot is loaded!");

  // Example: when a pull request is opened or synchronized
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    const pr = context.payload.pull_request;
    const repo = context.repo();

    app.log.info(`PR #${pr.number} in ${repo.owner}/${repo.repo}: ${pr.title}`);

    // TODO: Fetch changed files and analyze semantics
    // For now, just leave a friendly comment as a starting point
    const comment = {
      body: `🤖 **Semantic Organizer** checked this PR.\n\nThis is a starter bot. Next steps could include:\n- Extracting function/class summaries\n- Updating or generating semantic documentation\n- Suggesting better organization of code by meaning\n\nFeel free to expand the logic in index.js!`,
    };

    await context.octokit.issues.createComment(context.issue(comment));
  });

  // Example: on push to main, could scan the whole repo
  app.on("push", async (context) => {
    if (context.payload.ref === "refs/heads/main") {
      app.log.info("Push to main detected — ready to organize semantics");
      // TODO: Trigger full semantic scan / update
    }
  });

  app.onError(async (error) => {
    app.log.error(error);
  });
};
