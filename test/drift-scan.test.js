const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MODEL_ID, rankDriftPairs, createDriftScanner } = require("../drift-scan");

function catalog() {
  return [
    { id: "S1P1", quote: "A durable trace remains after the original pressure has passed.", source: { id: "S1" } },
    { id: "S1P2", quote: "A different passage from the same source stays nearby in meaning.", source: { id: "S1" } },
    { id: "S2P1", quote: "An earlier interpretation continues to shape the next question.", source: { id: "S2" } },
    { id: "S3P1", quote: "A later question can carry an earlier frame into a new setting.", source: { id: "S3" } }
  ];
}

test("Drift Scan ranks bounded cross-file candidates without reverse or same-file pairs", async () => {
  const pairs = await rankDriftPairs(catalog(), async texts => {
    assert.equal(texts.length, 4);
    return [[1, 0], [0.8, 0.6], [0.6, 0.8], [0, 1]];
  }, { minScore: 0.55, maxScore: 0.9, limit: 12 });
  assert.deepEqual(pairs, [
    { passageIds: ["S2P1", "S3P1"], score: 0.8 },
    { passageIds: ["S1P1", "S2P1"], score: 0.6 },
    { passageIds: ["S1P2", "S3P1"], score: 0.6 }
  ]);
  assert.ok(pairs.every(pair => pair.passageIds[0] !== pair.passageIds[1]));
  assert.ok(!pairs.some(pair => pair.passageIds.includes("S1P1") && pair.passageIds.includes("S1P2")));
});

test("Drift Scan excludes identical quotations and near-duplicate embeddings", async () => {
  const passages = catalog();
  passages[2].quote = passages[0].quote;
  const pairs = await rankDriftPairs(passages, async () => [[1, 0], [0.8, 0.6], [0.6, 0.8], [0, 1]],
    { minScore: 0.55, maxScore: 0.9, limit: 12 });
  assert.ok(!pairs.some(pair => pair.passageIds.includes("S1P1") && pair.passageIds.includes("S2P1")));
});

test("the local Transformers.js scanner batches embeddings and disposes the pipeline", async () => {
  const batches = [];
  let disposed = 0;
  const scanner = createDriftScanner({
    loadPipeline: async () => async (task, model, options) => {
      assert.equal(task, "feature-extraction");
      assert.equal(model, MODEL_ID);
      assert.equal(options, undefined);
      const extractor = async texts => {
        batches.push(texts);
        const vectors = texts.map(text => text.includes("durable") ? [1, 0]
          : text.includes("different") ? [0.8, 0.6] : text.includes("interpretation") ? [0.6, 0.8] : [0, 1]);
        return { dims: [texts.length, 2], data: Float32Array.from(vectors.flat()) };
      };
      extractor.dispose = async () => { disposed++; };
      return extractor;
    }
  });
  const pairs = await scanner(catalog());
  assert.equal(batches.length, 1);
  assert.deepEqual(pairs, [
    { passageIds: ["S2P1", "S3P1"], score: 0.8 },
    { passageIds: ["S1P1", "S2P1"], score: 0.6 },
    { passageIds: ["S1P2", "S3P1"], score: 0.6 }
  ]);
  assert.equal(disposed, 1);
});

test("a local-model failure is safe, logged without source text, and does not throw", async () => {
  const entries = [];
  const scanner = createDriftScanner({
    loadPipeline: async () => { throw Object.assign(new Error("provider said: durable trace remains"), { code: "network_failure" }); },
    log: { warn: (...entry) => entries.push(entry) }
  });
  assert.deepEqual(await scanner(catalog()), []);
  assert.deepEqual(entries, [[{ provider: "huggingface", code: "network_failure" }, "Drift scan unavailable; continuing without a shortlist"]]);
  assert.ok(!JSON.stringify(entries).includes("durable trace"));
});
