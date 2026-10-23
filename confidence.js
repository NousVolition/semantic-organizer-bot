const CONFIDENCE_RULES = `Tag support for the author's idea AS STATED, not the author's ability, personal confidence, worth, novelty or future promise. This is a qualitative, fallible assessment, not a calibrated probability. High: the supplied evidence directly supports the narrowly scoped claim; explain the derivation/observation and its limits. Medium: there is relevant support with material gaps; use lower (substantial missing links), middle (partly supported), or upper (narrow remaining gap). Low: key support is absent or conflicting; distinguish an untested possibility from a contradicted claim. Not assessed: the request/tool does not evaluate this question. Creative ideas need not be rejected or called false because empirical support is low. Give a specific basis, an optional next step that could strengthen the claim, and the wording/scope to pull back if needed (say no narrowing needed when justified). High confidence in an initial-field result does not transfer to global evolution. A diagram's successful construction says nothing about correctness of manually supplied roles. Confidence never overrides failed citation or claim-scope checks. Preserve deliberate understatement and the exact phrase preserves Sens while adjusting Sin when it fits. Do not invent numeric percentages or recommend research priorities.`;

function confidenceSchema({ constrainLevelBand = false } = {}) {
  const branch = (levels, bands) => ({ type: 'object', additionalProperties: false,
    required: ['level', 'band', 'basis', 'strengthen', 'pullBack'], properties: {
      level: { type: 'string', enum: levels },
      band: { type: 'string', enum: bands },
      basis: { type: 'string', minLength: 1, maxLength: 1200, pattern: '\\S' },
      strengthen: { type: 'string', minLength: 1, maxLength: 1200, pattern: '\\S' },
      pullBack: { type: 'string', minLength: 1, maxLength: 1200, pattern: '\\S' }
    } });
  // Idea review derives its level from a separate support verdict and removes level.
  if (!constrainLevelBand) return branch(['high', 'medium', 'low', 'not_assessed'], ['lower', 'middle', 'upper', 'none']);
  // Discovery generates both fields; enforce the combinations its publisher accepts.
  return { anyOf: [branch(['medium'], ['lower', 'middle', 'upper']),
    branch(['high', 'low', 'not_assessed'], ['none'])] };
}
function validConfidence(c) {
  return c && ['high', 'medium', 'low', 'not_assessed'].includes(c.level)
    && (c.level === 'medium' ? ['lower', 'middle', 'upper'].includes(c.band) : c.band === 'none')
    && ['basis', 'strengthen', 'pullBack'].every(k => typeof c[k] === 'string' && c[k].trim() && c[k].length <= 1200);
}
function renderConfidence(c, safeText) {
  if (!validConfidence(c)) return '\n**Confidence: Not assessed** — No complete confidence assessment was supplied.';
  const label = c.level === 'not_assessed' ? 'Not assessed' : c.level[0].toUpperCase() + c.level.slice(1);
  return `\n**Confidence: ${label}${c.level === 'medium' ? ` (${c.band})` : ''}** — support for this claim as written; not a probability.\n\n**Basis:** ${safeText(c.basis, 1200)}\n\n**To strengthen:** ${safeText(c.strengthen, 1200)}\n\n**To narrow:** ${safeText(c.pullBack, 1200)}`;
}
module.exports = { CONFIDENCE_RULES: `${CONFIDENCE_RULES} Name the author's original idea being assessed. Confidence in finding an error is not support for that idea: a claim defeated by an explicit counterexample has Low support even when the criticism is certain. Do not transfer a correction's High support to the incorrect original. A coherent concept alone does not supply empirical evidence for an untested implementation.`, confidenceSchema, validConfidence, renderConfidence };
