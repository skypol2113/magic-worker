// worker/translators/embeddings.js
const {GoogleAuth} = require('google-auth-library');

const project = process.env.FIREBASE_PROJECT_ID
  || process.env.GOOGLE_CLOUD_PROJECT
  || process.env.project_id;

const location = process.env.VERTEX_LOCATION || 'us-central1';

// Vertex REST endpoint for embeddings 004
function embeddingsEndpoint() {
  // v1 publisher model endpoint (predict)
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-004:predict`;
}

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// --- Utils ---
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    n1 += x * x;
    n2 += y * y;
  }
  if (n1 === 0 || n2 === 0) return 0;
  return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

// --- Core: get embedding via REST ---
async function getEmbedding(text) {
  const t = (text || '').trim();
  if (!t) return [];

  if (!project) {
    console.warn('Embedding: no GCP project configured');
    return [];
  }

  try {
    const client = await auth.getClient();
    const url = embeddingsEndpoint();

    // predict schema for text-embedding-004:
    // request: { instances: [{ content: "..." }], parameters?: { outputDimensionality?: number } }
    // response: predictions[0].embeddings.values
    const body = {
      instances: [{ content: t }],
      // необязательно: можешь убрать или выставить 768/1024
      parameters: process.env.EMBEDDINGS_DIM
        ? { outputDimensionality: Number(process.env.EMBEDDINGS_DIM) }
        : undefined,
    };

    const started = Date.now();
    const res = await client.request({
      url,
      method: 'POST',
      data: body,
    });

    const preds = res.data?.predictions || [];
    const values = preds[0]?.embeddings?.values || [];
    const ms = Date.now() - started;

    console.log(`🧠 Vertex REST embeddings: dim=${values.length}, ${ms}ms`);
    return values;
  } catch (err) {
    // самые частые причины: API не включён, нет биллинга, нет роли aiplatform.user
    console.error('❌ Embedding generation failed:', err?.message || err);
    return [];
  }
}

async function semanticSimilarity(a, b) {
  if (!a || !b) return 0;
  const [ea, eb] = await Promise.all([getEmbedding(a), getEmbedding(b)]);
  const s = cosineSimilarity(ea, eb);
  console.log(`📊 Similarity=${s.toFixed(3)} | "${a.slice(0, 24)}…" vs "${b.slice(0, 24)}…"`);
  return s;
}

// Простая классификация без LLM (регексы-стаб, чтобы не жечь токены на prod)
async function classifyText(text) {
  const t = (text || '').toLowerCase();
  if (/(car|auto|vehicle|bmw|toyota|mercedes|tesla)/.test(t)) return 'auto';
  if (/(learn|study|teach|education|course)/.test(t)) return 'learning';
  if (/(friend|meet|people|social|connection)/.test(t)) return 'social';
  if (/(travel|trip|journey|adventure)/.test(t)) return 'travel';
  if (/(health|fitness|sport|exercise|yoga)/.test(t)) return 'health';
  if (/(music|art|movie|entertainment|fun)/.test(t)) return 'entertainment';
  return 'general';
}

module.exports = {
  getEmbedding,
  semanticSimilarity,
  classifyText,
  cosineSimilarity,
};
