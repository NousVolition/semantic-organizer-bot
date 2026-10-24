const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { skillsForMode } = require("../language-skills");
const skills = readFileSync(join(__dirname, "../language-skills.md"), "utf8");

test("discovery keeps useful explorations and excludes the direct-review stop rule", () => {
  const selected = skillsForMode(skills, "discovery");
  assert.match(selected, /Continue looking for useful, source-supported words/);
  assert.doesNotMatch(selected, /If nothing needs attention in this direct review/);
  assert.doesNotMatch(selected, /\*\*Needs attention\*\*/);
  assert.match(selected, /Owner's glossary/);
  assert.match(selected, /Role: adviser/);
});

test("direct reviews keep the requested format without discovery-only instructions", () => {
  const selected = skillsForMode(skills, "review");
  assert.match(selected, /If nothing needs attention in this direct review/);
  assert.match(selected, /\*\*Needs attention\*\*/);
  assert.doesNotMatch(selected, /Continue looking for useful, source-supported words/);
  assert.match(selected, /Owner's glossary/);
});

test("unknown modes or missing mode sections fail clearly", () => {
  assert.throws(() => skillsForMode(skills, "other"), /Unknown/);
  assert.throws(() => skillsForMode("# Incomplete rules", "discovery"), /both response formats/);
});

test('both entry modes inherit the same contextual meaning rules',()=>{
  const {CONTEXT_RULES}=require('../contextual-fidelity');
  for(const mode of ['review','discovery'])assert.ok(skillsForMode(skills,mode).includes(CONTEXT_RULES));
});
