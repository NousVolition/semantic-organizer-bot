const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Owner-maintained definitions, shared by generation and the publication reviewer.
// Sources being examined cannot edit or add instructions to this trusted file.
const CORPUS_GUIDANCE = readFileSync(join(__dirname, "corpus-definitions.md"), "utf8");

module.exports = { CORPUS_GUIDANCE };
