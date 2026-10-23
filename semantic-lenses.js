const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// One trusted, editable rule source for generation and independent publication review.
const SEMANTIC_LENSES = readFileSync(join(__dirname, 'semantic-lenses.md'), 'utf8');
const SEMANTIC_CHECKS = ['reference_fidelity', 'inference_fidelity', 'relation_fidelity', 'voice_fidelity'];

module.exports = { SEMANTIC_LENSES, SEMANTIC_CHECKS };
