const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";
const DEFAULT_OPTIONS = Object.freeze({ minScore: 0.55, maxScore: 0.9, limit: 8, batchSize: 16 });

function driftError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function settings(options = {}) {
  const minScore = Number.isFinite(options.minScore) ? options.minScore : DEFAULT_OPTIONS.minScore;
  const maxScore = Number.isFinite(options.maxScore) ? options.maxScore : DEFAULT_OPTIONS.maxScore;
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_OPTIONS.limit;
  const batchSize = Number.isInteger(options.batchSize) ? options.batchSize : DEFAULT_OPTIONS.batchSize;
  if (minScore < -1 || maxScore > 1 || minScore >= maxScore || limit < 1 || limit > 20 || batchSize < 1 || batchSize > 64)
    throw driftError("invalid_drift_options");
  return { minScore, maxScore, limit, batchSize };
}

function usablePassages(catalog) {
  return (Array.isArray(catalog) ? catalog : []).filter(item => typeof item?.id === "string"
    && typeof item?.quote === "string" && item.quote.trim().length >= 15 && typeof item?.source?.id === "string");
}

function normalize(vector) {
  if (!vector || typeof vector.length !== "number" || vector.length < 1) throw driftError("invalid_embeddings");
  let magnitude = 0;
  const result = new Float64Array(vector.length);
  for (let index = 0; index < vector.length; index++) {
    const value = Number(vector[index]);
    if (!Number.isFinite(value)) throw driftError("invalid_embeddings");
    result[index] = value;
    magnitude += value * value;
  }
  if (magnitude <= 0) throw driftError("invalid_embeddings");
  magnitude = Math.sqrt(magnitude);
  for (let index = 0; index < result.length; index++) result[index] /= magnitude;
  return result;
}

function similarity(left, right) {
  if (left.length !== right.length) throw driftError("embedding_dimensions");
  let score = 0;
  for (let index = 0; index < left.length; index++) score += left[index] * right[index];
  return Math.max(-1, Math.min(1, score));
}

function embeddingRows(output, expectedRows) {
  if (Array.isArray(output)) return output;
  if (typeof output?.tolist === "function") return output.tolist();
  if (!output?.data || !Array.isArray(output.dims) || output.dims.length !== 2) throw driftError("invalid_embeddings");
  const [rows, width] = output.dims;
  if (!Number.isInteger(rows) || !Number.isInteger(width) || rows !== expectedRows || width < 1 || output.data.length !== rows * width)
    throw driftError("invalid_embeddings");
  return Array.from({ length: rows }, (_, row) => output.data.slice(row * width, (row + 1) * width));
}

async function rankDriftPairs(catalog, embed, options = {}) {
  if (typeof embed !== "function") throw driftError("invalid_embedder");
  const passages = usablePassages(catalog);
  if (new Set(passages.map(item => item.source.id)).size < 2) return [];
  const config = settings(options);
  const rows = await embed(passages.map(item => item.quote));
  if (!Array.isArray(rows) || rows.length !== passages.length) throw driftError("invalid_embeddings");
  const embeddings = rows.map(normalize);
  const pairs = [];
  for (let left = 0; left < passages.length; left++) {
    for (let right = left + 1; right < passages.length; right++) {
      if (passages[left].source.id === passages[right].source.id || passages[left].quote === passages[right].quote) continue;
      const score = similarity(embeddings[left], embeddings[right]);
      if (score < config.minScore || score >= config.maxScore) continue;
      pairs.push({ passageIds: [passages[left].id, passages[right].id], score: Number(score.toFixed(4)) });
    }
  }
  return pairs.sort((left, right) => right.score - left.score || left.passageIds[0].localeCompare(right.passageIds[0])
    || left.passageIds[1].localeCompare(right.passageIds[1])).slice(0, config.limit);
}

function errorCode(error) {
  return typeof error?.code === "string" && /^[a-z_]{1,64}$/.test(error.code) ? error.code : "unavailable";
}

function warning(log, code, message) {
  log?.warn?.({ provider: "huggingface", code }, message);
}

function createDriftScanner({ loadPipeline, log, model = MODEL_ID, options } = {}) {
  const getPipeline = loadPipeline || (async () => (await import("@huggingface/transformers")).pipeline);
  return async function scan(catalog) {
    const passages = usablePassages(catalog);
    if (new Set(passages.map(item => item.source.id)).size < 2) return [];
    let extractor;
    try {
      const pipeline = await getPipeline();
      if (typeof pipeline !== "function") throw driftError("invalid_pipeline");
      // Let the model's Transformers.js manifest select its supported default
      // artifact. This avoids assuming that every Hub conversion exposes q8.
      extractor = await pipeline("feature-extraction", model);
      if (typeof extractor !== "function") throw driftError("invalid_pipeline");
      const config = settings(options);
      return await rankDriftPairs(passages, async texts => {
        const rows = [];
        for (let start = 0; start < texts.length; start += config.batchSize) {
          const batch = texts.slice(start, start + config.batchSize);
          const output = await extractor(batch, { pooling: "mean", normalize: true });
          rows.push(...embeddingRows(output, batch.length));
        }
        return rows;
      }, config);
    } catch (error) {
      warning(log, errorCode(error), "Drift scan unavailable; continuing without a shortlist");
      return [];
    } finally {
      if (typeof extractor?.dispose === "function") {
        try {
          await extractor.dispose();
        } catch (_) {
          warning(log, "dispose_failed", "Drift scan cleanup failed");
        }
      }
    }
  };
}

module.exports = { MODEL_ID, embeddingRows, rankDriftPairs, createDriftScanner };
