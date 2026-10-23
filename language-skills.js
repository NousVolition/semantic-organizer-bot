const { CORPUS_GUIDANCE } = require("./corpus-knowledge");
const { CONFIDENCE_RULES } = require("./confidence");
const { WORDING_FIDELITY_RULES } = require("./wording-fidelity");
const headings = { review: "Direct text reviews", discovery: "Discovery reports" };

function skillsForMode(markdown, mode) {
  if (!Object.hasOwn(headings, mode)) throw new Error("Unknown language-review mode");
  const found = [];
  const selected = markdown.replace(
    /^### (Direct text reviews|Discovery reports)\r?\n[\s\S]*?(?=^#{1,3} |(?![\s\S]))/gm,
    (section, heading) => {
      found.push(heading);
      return heading === headings[mode] ? section : "";
    },
  );
  if (found.length !== 2 || new Set(found).size !== 2)
    throw new Error("Language skills must define both response formats exactly once");
  return `${selected}\n\n${CORPUS_GUIDANCE}\n\n${CONFIDENCE_RULES}\n\n${WORDING_FIDELITY_RULES}`;
}

module.exports = { skillsForMode };
