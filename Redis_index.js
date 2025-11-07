// Magic Worker - ROOT version (real matches only, no synthetic) + Embeddings + Redis vector index (graceful fallback)
// ==================================================================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const _ = require('lodash');

// --- translators (GCT v3 / Vertex) ---
const translators = require('./worker/translators');

// --- embeddings (Vertex/OpenAI, pluggable) ---
const embeddingsEnabled = (process.env.EMBEDDINGS_ENABLED || 'true').toLowerCase() !== 'false';
let embedder = null;
if (embeddingsEnabled) {
  try {
    embedder = require('./worker/embeddings');
  } catch (e) {
    console.warn('Embeddings provider init failed, fallback to heuristics:', e.message || e);
    embedder = null;
  }
}

// ===== Firebase Admin (глобально, один раз) =====
const admin = require('firebase-admin');
const FV = admin.firestore.FieldValue;
const TS = admin.firestore.Timestamp;

// ---- Redis (optional) for vector index (RediSearch) ----
const REDIS_ENABLED = (process.env.REDIS_ENABLED || 'true').toLowerCase() !== 'false';
const REDIS_VECTOR_ENABLED = (process.env.REDIS_VECTOR_ENABLED || 'true').toLowerCase() !== 'false';
const redis = (REDIS_ENABLED || REDIS_VECTOR_ENABLED) ? require('redis') : null;

let redisClient = null;
let redisReady = false;
let redisSearchAvailable = false;
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'wm';
const REDIS_INDEX = `${REDIS_PREFIX}:intents`;
const REDIS_VEC_FIELD = 'vec';
const REDIS_TEXT_FIELD = 'text';
const REDIS_USER_FIELD = 'userId';

// --- Vector search parameters (can be tuned via .env) ---
const VEC_TOPK = parseInt(process.env.EMBEDDINGS_TOP_K || '5', 10);
const CAND_LIMIT = parseInt(process.env.EMBEDDINGS_CANDIDATE_LIMIT || '200', 10);
const MIN_SIM = Number(process.env.EMBEDDINGS_MIN_SIM || '0.55');

// --- Matching limit per intent ---
const MATCH_TOP_N = parseInt(process.env.MATCH_TOP_N || '1', 10);

const app = express();
app.use(cors());
app.use(express.json());

// ========== Firebase bootstrap ==========
let firebaseLoaded = false;
let db = null;

function tryLoadFromConfigModule() {
  try {
    const { db: firebaseDb } = require('./config/firebase');
    if (firebaseDb) {
      db = firebaseDb;
      firebaseLoaded = true;
      console.log('✅ Firebase loaded via ./config/firebase');
    }
    if (admin.apps.length) {
      console.log('✅ Admin initialized (from config module)');
    }
  } catch (e) {
    console.log('ℹ️ config/firebase not used:', e.message);
  }
}

function tryInitAdminFallback() {
  if (firebaseLoaded || db) return;
  try {
    if (admin.apps.length === 0) {
      const pk = (process.env.private_key || '').replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert({
          project_id: process.env.project_id,
          client_email: process.env.client_email,
          private_key: pk,
        }),
      });
    }
    if (!db) db = admin.firestore();
    firebaseLoaded = !!db;
    console.log('✅ Firebase initialized via admin fallback');
  } catch (e) {
    console.error('❌ Firebase admin init failed:', e);
  }
}

tryLoadFromConfigModule();
tryInitAdminFallback();

// ======= Helpers =======
function nowIso() { return new Date().toISOString(); }
function short(str, n = 80) { if (!str) return ''; return str.length > n ? str.substring(0, n) + '…' : str; }
function docWasProcessed(doc) { const d = doc.data() || {}; return !!d.workerProcessed || !!d.processedAt; }
function get(obj, path, def = undefined) {
  return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj) ?? def;
}

// --- idempotency key for pair A<->B + their intents ---
function pairKey(aUid, bUid, aIntentId, bIntentId) {
  const uids = [aUid || '', bUid || ''].sort().join('|');
  const intents = [aIntentId || '', bIntentId || ''].sort().join('|');
  const material = `intent|${uids}|${intents}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

// ======= Matching logic (light heuristics) =======
function detectCategories(text) {
  const t = (text || '').toLowerCase();
  if (/(авто|машин|автомоб|car|bmw|toyota|mercedes|tesla)/i.test(t)) return ['auto'];
  const cats = [];
  if (/(learn|study|teach|education|курс|обучение)/i.test(t)) cats.push('learning');
  if (/(friend|meet|people|social|друг|знакомств)/i.test(t)) cats.push('social');
  if (/(travel|trip|journey|путешеств)/i.test(t)) cats.push('travel');
  if (/(health|fitness|sport|exercise|здоровь)/i.test(t)) cats.push('health');
  if (/(music|art|movie|entertainment|музык|кино)/i.test(t)) cats.push('entertainment');
  return cats.length ? cats : ['general'];
}
function getMagicType(category) {
  const magicMap = {
    auto: 'market',
    learning: 'knowledge',
    social: 'connection',
    travel: 'adventure',
    health: 'vitality',
    entertainment: 'fun',
    general: 'magic',
  };
  return magicMap[category] || 'magic';
}
function generateMatchText(originalText, category) {
  const t = (originalText || '').trim();
  const key = t ? t.split(/\s+/).slice(0, 2).join(' ') : 'интерес';
  const templates = {
    learning: `Я тоже хочу научиться: ${key}`,
    social: `Ищу компанию для: ${key}`,
    travel: `Мечтаю о поездке: ${key}`,
    auto: `Интересуюсь авто: ${key}`,
    default: `Я тоже интересуюсь: ${key}`,
  };
  return templates[category] || templates.default;
}

// ===============================
// Embedding math & codecs
// ===============================
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function float32ToBase64(f32) {
  const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  return buf.toString('base64');
}
function base64ToFloat32(b64) {
  if (!b64) return new Float32Array(0);
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

// ===============================
// Redis bootstrap (optional)
// ===============================
async function initRedis() {
  if (!redis || !(REDIS_ENABLED || REDIS_VECTOR_ENABLED)) return;
  try {
    // prefer URL if provided
    const url = process.env.REDIS_URL ||
      `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`;

    const opts = { url };
    if (process.env.REDIS_PASSWORD) {
      opts.password = process.env.REDIS_PASSWORD;
    }
    redisClient = redis.createClient(opts);

    redisClient.on('error', (err) => {
      redisReady = false;
      console.warn('Redis error:', err?.message || err);
    });
    redisClient.on('ready', () => {
      redisReady = true;
      console.log('✅ Redis connected:', url);
    });

    await redisClient.connect();

    // check RediSearch availability
    try {
      const list = await redisClient.sendCommand(['FT._LIST']);
      redisSearchAvailable = Array.isArray(list);
      if (redisSearchAvailable) console.log('✅ RediSearch module detected');
    } catch (e) {
      redisSearchAvailable = false;
      console.log('ℹ️ RediSearch not available; semantic search will fallback to Firestore window');
    }
  } catch (e) {
    console.warn('Redis init failed; fallback:', e.message || e);
  }
}

// Ensure vector index (HNSW) exists
async function ensureRedisIndex(dim) {
  if (!redisReady || !redisSearchAvailable) return false;
  try {
    // If index exists, FT.INFO will succeed
    await redisClient.sendCommand(['FT.INFO', REDIS_INDEX]);
    return true;
  } catch {
    // Create index
    const SCHEMA = [
      'SCHEMA',
      REDIS_TEXT_FIELD, 'TEXT',
      REDIS_USER_FIELD, 'TAG',
      REDIS_VEC_FIELD, 'VECTOR', 'HNSW', '6',
        'TYPE', 'FLOAT32',
        'DIM', String(dim),
        'DISTANCE_METRIC', 'COSINE',
        'M', '16'
    ];
    try {
      await redisClient.sendCommand(['FT.CREATE', REDIS_INDEX,
        'ON', 'HASH',
        'PREFIX', '1', `${REDIS_PREFIX}:intent:`,
        ...SCHEMA
      ]);
      console.log(`✅ RediSearch HNSW index created: ${REDIS_INDEX} (dim=${dim})`);
      return true;
    } catch (e) {
      console.warn('FT.CREATE failed; fallback:', e.message || e);
      return false;
    }
  }
}

// Store/Update one intent vector in Redis
async function redisUpsertIntentVector(intentId, userId, f32Vector, text) {
  if (!redisReady || !redisSearchAvailable) return false;
  const key = `${REDIS_PREFIX}:intent:${intentId}`;
  try {
    const buf = Buffer.from(f32Vector.buffer, f32Vector.byteOffset, f32Vector.byteLength);
    await redisClient.hSet(key, {
      [REDIS_TEXT_FIELD]: (text || '').toString(),
      [REDIS_USER_FIELD]: userId || '',
      [REDIS_VEC_FIELD]: buf, // raw binary is ok
    });
    return true;
  } catch (e) {
    console.warn('redisUpsertIntentVector failed:', e.message || e);
    return false;
  }
}

// Vector topK in Redis
async function redisVectorSearchTopK(f32Query, meUserId, topK) {
  if (!redisReady || !redisSearchAvailable) return [];
  try {
    const buf = Buffer.from(f32Query.buffer, f32Query.byteOffset, f32Query.byteLength);

    // Filter out my own user
    const userFilter = meUserId ? `-@${REDIS_USER_FIELD}:{${meUserId}}` : '*';

    // FT.SEARCH <index> <query> PARAMS 2 vec_param <blob> RETURN 3 id score text SORTBY __vscore DIALECT 2
    const K = Math.max(topK, 1);
    const CMD = [
      'FT.SEARCH', REDIS_INDEX,
      userFilter,
      'PARAMS', '2', 'vec_param', buf,
      'DIALECT', '2',
      'SORTBY', '__v_score',
      'RETURN', '3', 'id', REDIS_TEXT_FIELD, REDIS_USER_FIELD,
      'LIMIT', '0', String(Math.max(K * 3, K)), // take a few extra to later apply MIN_SIM
      'VECTOR', 'KNN', String(K * 3), REDIS_VEC_FIELD, 'vec_param', 'AS', '__v_score'
    ];

    // RediSearch v2.8 uses: '=>[KNN K @vec $vec_param AS __v_score]'
    // But modern servers accept VECTOR KNN as shown above; if not, try legacy:
    let resp;
    try {
      resp = await redisClient.sendCommand(CMD);
    } catch {
      // Legacy dialect
      resp = await redisClient.sendCommand([
        'FT.SEARCH', REDIS_INDEX,
        `${userFilter}=>[KNN ${String(K * 3)} @${REDIS_VEC_FIELD} $vec_param AS __v_score]`,
        'PARAMS', '2', 'vec_param', buf,
        'DIALECT', '2',
        'SORTBY', '__v_score',
        'RETURN', '3', 'id', REDIS_TEXT_FIELD, REDIS_USER_FIELD,
        'LIMIT', '0', String(Math.max(K * 3, K))
      ]);
    }

    // Parse results
    // resp format: [total, key1, [field, val, ...], key2, [...], ...]
    const out = [];
    for (let i = 1; i < resp.length; i += 2) {
      const key = resp[i];
      const fields = resp[i + 1];
      const rec = {};
      for (let j = 0; j < fields.length; j += 2) {
        rec[fields[j]] = fields[j + 1];
      }
      const id = (rec.id || '').toString();
      const userId = (rec[REDIS_USER_FIELD] || '').toString();
      const text = (rec[REDIS_TEXT_FIELD] || '').toString();
      // __v_score is distance; convert to cosine sim ~ 1 - dist (rough)
      // If server returns raw distance, smaller is better. We'll map to sim:
      const distRaw = Number(rec.__v_score || 0);
      const sim = isFinite(distRaw) ? (1 - distRaw) : 0;
      // Key form: wm:intent:<docId>
      const docId = id.split(':').pop();
      out.push({ id: docId, userId, text, score: sim });
    }
    return out;
  } catch (e) {
    console.warn('redisVectorSearchTopK failed:', e.message || e);
    return [];
  }
}

// ======= Privacy-safe snapshots & push =======
async function ensurePrivateDoc(uid, seed = {}) {
  const now = FV.serverTimestamp();
  const ref = db.doc(`users_private/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      emailVerified: false,
      phoneVerified: false,
      contacts: { email: null, phone: null, telegram: null, whatsapp: null, preferred: null },
      devices: [],
      createdAt: now,
      updatedAt: now,
      ...seed,
    }, { merge: true });
    await db.collection('audit_events').add({
      type: 'sign_up',
      uid,
      createdAt: now,
      version: 1,
    });
    console.log('🧩 users_private created for', uid);
  } else {
    await ref.set({ updatedAt: now, ...seed }, { merge: true });
  }
}

async function getUserSafeSnapshot(uid) {
  const [pubSnap, privSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`users_private/${uid}`).get(),
  ]);
  const u = pubSnap.exists ? pubSnap.data() || {} : {};
  const p = privSnap.exists ? privSnap.data() || {} : {};

  return {
    displayName: u.displayName ?? '',
    photoURL: u.photoURL ?? null,
    loc: {
      city: get(u, 'loc.city', ''),
      countryCode: get(u, 'loc.countryCode', ''),
      district: get(u, 'loc.district', ''),
    },
    contacts: {
      phone: get(p, 'contacts.phone', null),
      telegram: get(p, 'contacts.telegram', null),
      whatsapp: get(p, 'contacts.whatsapp', null),
      email: get(p, 'contacts.email', null),
      preferred: get(p, 'contacts.preferred', null),
    },
    languages: Array.isArray(u.languages) ? u.languages.slice(0, 5) : null,
    sharedAt: FV.serverTimestamp(),
    version: 1,
  };
}

async function sendPushToUser(uid, payload) {
  try {
    const us = await db.doc(`users/${uid}`).get();
    const tokens = (us.exists ? us.get('fcmTokens') : []) || [];
    const valid = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
    if (!valid.length) {
      console.log('🔕 No tokens for uid', uid);
      return;
    }
    const msg = {
      tokens: valid,
      notification: payload.notification || undefined,
      data: payload.data || {},
    };
    const resp = await admin.messaging().sendEachForMulticast(msg);
    console.log(`📬 Push to ${uid}: success=${resp.successCount}, fail=${resp.failureCount}`);
  } catch (e) {
    console.error('❌ sendPushToUser error:', e);
  }
}

// ----- readPublicMeta -----
async function readPublicMeta(uid) {
  try {
    const snap = await db.doc(`users/${uid}`).get();
    const u = snap.exists ? (snap.data() || {}) : {};
    const loc = u.loc || {};
    const anchor = u.anchor || {};

    const admin2 = (loc.district || loc.admin2 || '').toString();
    const city = (loc.city || '').toString();
    const countryCode = (loc.countryCode || '').toString();
    const countryName = (loc.countryName || '').toString();

    const parts = [];
    if (admin2) parts.push(admin2);
    if (city) parts.push(city);
    if (countryName || countryCode) parts.push(countryName || countryCode);
    const display = parts.filter(Boolean).join(' • ');

    return {
      text: (u.lastIntentText || '').toString(),
      loc: {
        admin2: admin2 || null,
        city: city || null,
        countryCode: countryCode || null,
        countryName: countryName || null,
        lat: typeof anchor.lat === 'number' ? anchor.lat : null,
        lng: typeof anchor.lng === 'number' ? anchor.lng : null,
        display: display || null,
      },
    };
  } catch {
    return { text: '', loc: {} };
  }
}

// ===============================
// Normalization
// ===============================
async function ensureNormalized(wishRef, wish) {
  const text = wish.text || '';
  if (!text.trim()) return;

  const already = _.get(wish, 'normalized.text');
  const lastText = _.get(wish, 'normalized._sourceText');
  if (already && lastText === text) return;

  let detected = wish.lang && wish.lang !== 'auto' ? wish.lang : null;
  try {
    if (!detected) detected = await translators.detectLanguage(text);
  } catch (e) {
    console.warn('Language detection failed, fallback to "und"', e.message);
    detected = 'und';
  }

  let normalizedText = text;
  let translated = false;
  let provider = process.env.TRANSLATOR_PROVIDER || 'gct';
  let providerMs = 0;

  if ((detected || '').toLowerCase() !== 'en') {
    try {
      const res = await translators.translateToEn(text, detected || 'auto');
      normalizedText = res.text || text;
      provider = res.provider || provider;
      providerMs = res.ms || 0;
      translated = !res.fallback;
    } catch (e) {
      console.warn('Translation failed, using original text', e.message || e);
      normalizedText = text;
      translated = false;
    }
  }

  await wishRef.set({
    normalized: {
      lang: 'en',
      text: normalizedText,
      detectedLang: detected || 'und',
      translated,
      provider,
      providerMs,
      _sourceText: text,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true });
}

// ===============================
// Embedding on doc (doc-level cache)
// ===============================
async function ensureEmbedded(ref, intent) {
  if (!embeddingsEnabled || !embedder) return null;

  const srcText = _.get(intent, 'normalized._sourceText') || intent.text || '';
  const prevSrc = _.get(intent, 'embedding._sourceText');
  const hasVec = _.get(intent, 'embedding.vec');
  if (hasVec && prevSrc === srcText) return _.get(intent, 'embedding', null);

  const textForEmb = _.get(intent, 'normalized.text') || intent.text || '';
  if (!textForEmb.trim()) return null;

  try {
    const { vector, dim, model, provider, ms } = await embedder.embed(textForEmb);
    if (!vector?.length) return null;
    const payload = {
      provider, model, dim,
      vec: float32ToBase64(vector),
      _sourceText: srcText,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await ref.set({ embedding: payload }, { merge: true });
    return payload;
  } catch (e) {
    console.warn('ensureEmbedded error:', e.message || e);
    return null;
  }
}

// ===============================
// Candidate selection (Redis first, fallback to Firestore)
// ===============================
async function selectCounterpartsForIntent(srcId, srcData, limit = 5) {
  // 1) Redis vector index path
  if (embeddingsEnabled && embedder && redisReady && redisSearchAvailable) {
    try {
      const srcEmbB64 = _.get(srcData, 'embedding.vec');
      if (!srcEmbB64) throw new Error('no source embedding');
      const queryVec = base64ToFloat32(srcEmbB64);
      if (!queryVec.length) throw new Error('empty source vector');

      // ensure index dimension matches
      const dim = Number(_.get(srcData, 'embedding.dim') || queryVec.length || 0);
      if (dim <= 0) throw new Error('unknown dim');
      const ok = await ensureRedisIndex(dim);
      if (!ok) throw new Error('index not ready');

      // Search
      const raw = await redisVectorSearchTopK(queryVec, srcData.userId, Math.max(limit, VEC_TOPK));
      // filter by MIN_SIM and drop self-doc
      const filtered = raw
        .filter(r => r.id !== srcId && r.userId && r.userId !== srcData.userId && r.score >= MIN_SIM)
        .slice(0, limit);

      // If Redis has enough results — return
      if (filtered.length) return filtered;
      // else continue to fallback
      console.log('ℹ️ Redis vector search yielded no strong hits, fallback to window');
    } catch (e) {
      console.warn('semantic (redis) select fallback:', e.message || e);
      // fallback to window
    }
  }

  // 2) Firestore window + local cosine
  if (embeddingsEnabled && embedder) {
    try {
      const snap = await db.collection('intents')
        .where('status', '==', 'published')
        .orderBy('createdAt', 'desc')
        .limit(CAND_LIMIT)
        .get();

      const srcEmb = srcData.embedding?.vec ? base64ToFloat32(srcData.embedding.vec) : null;
      if (!srcEmb || !srcEmb.length) throw new Error('no source embedding');

      const me = srcData.userId;
      const scored = [];
      snap.forEach(d => {
        if (d.id === srcId) return;
        const x = d.data() || {};
        if (!x.userId || x.userId === me) return;
        const vB64 = x.embedding?.vec;
        if (!vB64) return;
        const vec = base64ToFloat32(vB64);
        if (!vec.length) return;
        const sim = cosine(srcEmb, vec);
        if (sim >= MIN_SIM) scored.push({ id: d.id, ...x, score: sim });
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    } catch (e) {
      console.warn('semantic (window) select fallback to heuristics:', e.message || e);
      // fall through to heuristics
    }
  }

  // 3) Heuristic fallback (as before)
  const text = (srcData.text || '').toLowerCase();
  const me = srcData.userId;
  const snap = await db.collection('intents')
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const arr = [];
  snap.forEach(d => {
    if (d.id === srcId) return;
    const x = d.data() || {};
    if (!x.userId || x.userId === me) return;
    const tt = (x.text || '').toLowerCase();

    const hit =
      (text && tt.includes(text)) ||
      (text.includes('машин') && tt.includes('машин')) ||
      (text.includes('авто') && tt.includes('авто')) ||
      (text.includes('car') && tt.includes('car'));

    if (hit) {
      arr.push({ id: d.id, ...x, score: 0.9 });
    } else if (tt && text && (tt.split(/\s+/).some(w => text.includes(w)))) {
      arr.push({ id: d.id, ...x, score: 0.75 });
    }
  });

  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, limit);
}

// ===============================
// Processing
// ===============================
async function processGenericDoc(kind, doc) {
  const data = doc.data() || {};
  if (!data) return;

  const textRaw = data.text || '';
  const status = data.status;

  console.log(`🔮 Processing ${kind}:`, {
    id: doc.id,
    status,
    userId: data.userId || data.uid || 'unknown',
    text: short(textRaw, 60),
  });

  await new Promise((r) => setTimeout(r, 150));

  const batch = db.batch();
  const isIntent = kind === 'INTENT';
  const parentRef = isIntent
    ? db.collection('intents').doc(doc.id)
    : db.collection('wishes').doc(doc.id);

  // === normalize (quiet) ===
  try { await ensureNormalized(parentRef, data); }
  catch (e) { console.warn('normalize warn:', e.message || e); }

  // reload latest snapshot to catch normalized for embedding
  let fresh = data;
  try {
    const snap = await parentRef.get();
    if (snap.exists) fresh = snap.data() || data;
  } catch {}

  // === embed (quiet) ===
  try {
    if (embeddingsEnabled && embedder) {
      const emb = await ensureEmbedded(parentRef, fresh);
      if (emb) {
        // optionally push into Redis index
        if (redisReady && redisSearchAvailable) {
          try {
            const f32 = base64ToFloat32(emb.vec);
            await ensureRedisIndex(Number(emb.dim || f32.length || 0));
            await redisUpsertIntentVector(doc.id, fresh.userId || fresh.uid || '', f32, fresh.text || '');
          } catch (e) {
            console.warn('redis upsert skip:', e.message || e);
          }
        }
      }
    }
  } catch (e) {
    console.warn('embed warn:', e.message || e);
  }

  /// -------- INTENT: create ONLY real matches, up to MATCH_TOP_N --------
  if (isIntent) {
    // fetch again (embedding may be written)
    try {
      const snap2 = await parentRef.get();
      if (snap2.exists) fresh = snap2.data() || fresh;
    } catch {}

    const cps = await selectCounterpartsForIntent(doc.id, fresh, MATCH_TOP_N);
    const createdIds = [];
    const notifiedBUsers = [];

    const metaA = await readPublicMeta(fresh.userId).catch(() => ({ loc: {}, text: '' }));
    const pickLoc = (loc) => ({
      admin2: loc?.admin2 ?? null,
      city: loc?.city ?? null,
      countryCode: loc?.countryCode ?? null,
      countryName: loc?.countryName ?? null,
      display: loc?.display ?? null,
    });

    if (cps.length) {
      for (const c of cps.slice(0, MATCH_TOP_N)) {
        const pk = pairKey(fresh.userId, c.userId, doc.id, c.id);

        const dup = await db.collection('matches').where('pairKey', '==', pk).limit(1).get();
        if (!dup.empty) continue;

        const category = detectCategories(textRaw)[0] || 'general';
        const mRef = db.collection('matches').doc();

        const metaB = await readPublicMeta(c.userId).catch(() => ({ loc: {}, text: '' }));
        const aLoc = pickLoc(metaA.loc || {});
        const bLoc = pickLoc(metaB.loc || {});
        const regionDisplay =
          (bLoc.display && bLoc.display.trim()) ||
          (aLoc.display && aLoc.display.trim()) ||
          (c.regionDisplay || '') ||
          '';

        batch.set(mRef, {
          aUid: fresh.userId,
          bUid: c.userId,
          users: [fresh.userId, c.userId],
          participants: [fresh.userId, c.userId],

          aIntentId: doc.id,
          bIntentId: c.id,

          aText: (textRaw || ''),
          bText: (c.text || ''),

          aLoc, bLoc, regionDisplay,

          matchedText: generateMatchText(textRaw, category),
          category,
          magicType: getMagicType(category),
          matchType: 'semantic',
          similarity: c.score,
          score: c.score,
          confidence: Math.min(0.95, (typeof c.score === 'number' ? c.score : 0.75) + 0.05),

          approxDistanceKm: null,

          pairKey: pk,
          appId: 'com.magicai.box',
          source: 'intent',
          status: 'new',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        createdIds.push(mRef.id);
        notifiedBUsers.push(c.userId);
      }
    } else {
      console.log('ℹ️ No real counterparts found; skipping synthetic matches');
    }

    batch.update(parentRef, {
      processedAt: new Date(),
      workerProcessed: true,
      matchesCount: createdIds.length,
      workerVersion: 'magicbox-worker-emb-redis-1.0',
      workerLastRun: nowIso(),
    });

    await batch.commit();

    if (createdIds.length) {
      try {
        await sendPushToUser(fresh.userId, {
          notification: { title: 'Найдено совпадение', body: 'У вас новое совпадение' },
          data: { type: 'match_new' },
        });
        for (const bUid of notifiedBUsers) {
          await sendPushToUser(bUid, {
            notification: { title: 'Вас нашли', body: 'У вас новое совпадение' },
            data: { type: 'match_new' },
          });
        }

        const deliveredUids = [fresh.userId, ...notifiedBUsers];
        await Promise.all(
          createdIds.map((mid) =>
            db.doc(`matches/${mid}`).set(
              {
                deliveredTo: FV.arrayUnion(...deliveredUids),
                deliveredAt: FV.serverTimestamp(),
                updatedAt: FV.serverTimestamp(),
              },
              { merge: true }
            )
          )
        );
      } catch (e) {
        console.warn('push match_new warn:', e.message || e);
      }
    }

    console.log(`✅ INTENT processed (real-only):`, { id: doc.id, matches: createdIds.length });
    return;
  }

  // ---------- WISH synthetic (disabled path in your flow; keep legacy) ----------
  const textWish = textRaw;
  if (typeof generateMatches === 'function') {
    const synthetic = generateMatches(textWish, fresh);
    const created = [];
    for (const m of synthetic) {
      const mRef = db.collection('matches').doc();
      batch.set(mRef, {
        ...m,
        wishId: doc.id,
        aUid: fresh.uid,
        bUid: null,
        appId: 'com.magicai.box',
        source: 'wish',
        status: 'new',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      created.push(mRef.id);
    }

    batch.update(parentRef, {
      processedAt: new Date(),
      workerProcessed: true,
      matchesCount: created.length,
      workerVersion: 'magicbox-worker-emb-redis-1.0',
      workerLastRun: nowIso(),
    });

    await batch.commit();
    console.log(`✅ WISH processed:`, { id: doc.id, matches: created.length });
  }
}

function setupListener(collectionName, kind) {
  console.log(`🔍 Setting up listener: ${collectionName} (status == 'published')`);
  return db.collection(collectionName)
    .where('status', '==', 'published')
    .onSnapshot(
      (snapshot) => {
        console.log(`📡 ${collectionName} snapshot: size=${snapshot.size}, changes=${snapshot.docChanges().length}`);
        snapshot.docChanges().forEach((change) => {
          const { type, doc } = change;
          if (type === 'added' || type === 'modified') {
            if (docWasProcessed(doc)) return;
            const st = (doc.data() || {}).status;
            if (st !== 'published') return;
            processGenericDoc(kind, doc).catch((e) => {
              console.error(`❌ Error processing ${kind}:`, e);
            });
          }
        });
      },
      (error) => {
        console.error(`❌ ${collectionName} listener error:`, error);
      }
    );
}

function setupFirestoreListeners() {
  if (!db) {
    console.log('❌ Firebase not available for listeners');
    return;
  }
  setupListener('intents', 'INTENT');
  setupListener('wishes', 'WISH');
  setupUsersWatcher();
  setupContactRequestsWatcher();
  console.log('✅ Firestore listeners active: INTENTS, WISHES, USERS, CONTACT_REQUESTS');
}

// === USERS watcher ===
function setupUsersWatcher() {
  console.log('👤 Setting up USERS watcher');
  return db.collection('users').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        const doc = change.doc;
        const uid = doc.id;
        const data = doc.data() || {};
        if (!uid) return;

        try {
          const privRef = db.collection('users_private').doc(uid);
          const privSnap = await privRef.get();
          const isNew = !privSnap.exists;

          const serverNow = FV.serverTimestamp();
          const now = TS.now();

          const batch = db.batch();

          const base = { lastSeenAt: serverNow, updatedAt: serverNow };
          if (isNew) {
            base.createdAt = serverNow;
            base.firstSeenAt = serverNow;
          }
          batch.set(privRef, base, { merge: true });

          const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens.filter(Boolean) : [];
          const platform =
            Array.isArray(data.platforms) && data.platforms.length
              ? data.platforms[0]
              : (data.platform || 'unknown');

          if (tokens.length) {
            const deviceObjs = tokens.map((t) => ({
              platform,
              fcmToken: t,
              firstSeenAt: now,
              updatedAt: now,
            }));
            batch.set(privRef, { devices: FV.arrayUnion(...deviceObjs) }, { merge: true });
          }

          await batch.commit();
        } catch (e) {
          console.error('❌ USERS watcher upsert users_private failed:', e);
        }
      });
    },
    (error) => {
      console.error('❌ USERS watcher error:', error);
    }
  );
}

// === CONTACT_REQUESTS watcher ===
function setupContactRequestsWatcher() {
  console.log('🤝 Setting up CONTACT_REQUESTS watcher');
  return db.collection('contact_requests').onSnapshot(async (snap) => {
    for (const ch of snap.docChanges()) {
      if (ch.type === 'added') {
        const after = ch.doc.data() || {};
        const status = after.status;
        const fromUid = after.fromUid || after.requesterId;
        const toUid   = after.toUid   || after.recipientId;
        const matchId = after.matchId;

        if (status === 'pending' && toUid && matchId) {
          try {
            await sendPushToUser(toUid, {
              notification: { title: 'Запрос контакта', body: 'Пользователь запросил ваши контакты' },
              data: { type: 'contact_request_new', matchId, requestId: ch.doc.id },
            });
            await db.doc(`matches/${matchId}`).set({
              deliveredTo: admin.firestore.FieldValue.arrayUnion(toUid),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          } catch (e) {
            console.warn('contact_request pending push warn:', e.message || e);
          }
        }
        continue;
      }
      if (ch.type !== 'modified') continue;
      const after = ch.doc.data() || {};
      const before = ch.oldIndex >= 0 ? snap.docs[ch.oldIndex]?.data() : null;
      if (!before || before.status === after.status) continue;

      const status = after.status;
      const fromUid = after.requesterId || after.fromUid;
      const toUid = after.recipientId || after.toUid;
      const matchId = after.matchId;
      if (!fromUid || !toUid || !matchId) continue;

      if (status === 'accepted') {
        try {
          const safe = await getUserSafeSnapshot(toUid);
          const mRef = db.doc(`matches/${matchId}`);
          const mSnap = await mRef.get();
          if (mSnap.exists) {
            const m = mSnap.data() || {};
            let pathKey = null;
            if (m.aUid && m.bUid) {
              pathKey = toUid === m.aUid ? 'contact_snapshot.a'
                     : toUid === m.bUid ? 'contact_snapshot.b'
                     : null;
            } else {
              pathKey = 'contact_snapshot.receiver';
            }

            if (pathKey) {
              await mRef.set({
                [pathKey]: safe,
                contactsExchanged: true,
                [`contactAcceptedFor.${fromUid}`]: true,
                [`contactAcceptedFor.${toUid}`]: true,
                updatedAt: FV.serverTimestamp(),
              }, { merge: true });
            }
          }

          await sendPushToUser(fromUid, {
            notification: { title: 'Контакт доступен', body: 'Пользователь поделился контактами' },
            data: { type: 'contact_request_accepted', matchId, requestId: ch.doc.id },
          });

          await db.collection('audit_events').add({
            type: 'contact_share',
            uid: toUid,
            counterpartUid: fromUid,
            matchId,
            snapshot: { shared: Object.keys(safe.contacts || {}).filter(k => safe.contacts[k]) },
            createdAt: FV.serverTimestamp(),
            version: 1,
          });

          console.log('✅ contact accepted → snapshot written & push sent', { matchId, requestId: ch.doc.id });
        } catch (e) {
          console.error('❌ contact acceptance handling error', e);
        }
      }

      if (status === 'declined') {
        await sendPushToUser(fromUid, {
          notification: { title: 'Запрос отклонён', body: 'Контакты не были предоставлены' },
          data: { type: 'contact_request_declined', matchId, requestId: ch.doc.id },
        });
        console.log('ℹ️ contact declined → push sent', { matchId, requestId: ch.doc.id });
      }
    }
  }, (err) => console.error('❌ CONTACT_REQUESTS watcher error:', err));
}

// ======= HTTP =======
app.get('/', (req, res) => {
  res.json({
    message: '🔮 Magic Worker',
    status: 'running',
    firebase: firebaseLoaded ? 'connected' : 'not connected',
    features: [
      'intents listener',
      'wishes listener',
      'real matching (no synthetic)',
      'users_private bootstrap',
      'contact_requests → contact_snapshot',
      'FCM push',
      'audit events',
      'normalization before matching',
      'embeddings (Vertex/OpenAI)',
      'vector search via Redis (fallback to local cosine)'
    ],
    endpoints: [
      'GET /',
      'GET /api/redis',
      'GET /api/stats',
      'GET /api/debug-env',
      'POST /api/wish',
      'POST /api/publish-wish',
      'POST /api/detect',
      'POST /api/translate',
      'POST /api/embeddings/selftest'
    ],
  });
});

app.get('/api/redis', async (req, res) => {
  res.json({
    enabled: REDIS_ENABLED || REDIS_VECTOR_ENABLED,
    connected: redisReady,
    searchAvailable: redisSearchAvailable,
    index: REDIS_INDEX
  });
});

// Разовый бэкфилл (как было)
app.post('/admin/backfill-matches', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '300', 10), 1000);
    const snap = await db.collection('matches').orderBy('createdAt', 'desc').limit(limit).get();

    let updated = 0;
    for (const doc of snap.docs) {
      const m = doc.data() || {};
      const aUid = m.aUid || m.aUserId;
      const bUid = m.bUid || m.bUserId;
      const aIntentId = m.aIntentId;
      const bIntentId = m.bIntentId;
      if (!aUid || !bUid) continue;

      const upd = {};
      if (!m.aText && aIntentId) {
        const aInt = await db.doc(`intents/${aIntentId}`).get();
        if (aInt.exists) upd.aText = (aInt.data().text || '');
      }
      if (!m.bText && bIntentId) {
        const bInt = await db.doc(`intents/${bIntentId}`).get();
        if (bInt.exists) upd.bText = (bInt.data().text || '');
      }
      if (!Array.isArray(m.users) || m.users.length !== 2) {
        upd.users = [aUid, bUid];
      }
      if (!m.aLoc || !m.bLoc || !m.regionDisplay) {
        const [metaA, metaB] = await Promise.all([
          readPublicMeta(aUid).catch(() => ({ loc: {} })),
          readPublicMeta(bUid).catch(() => ({ loc: {} })),
        ]);
        if (!m.aLoc) upd.aLoc = metaA.loc || null;
        if (!m.bLoc) upd.bLoc = metaB.loc || null;
        if (!m.regionDisplay) {
          upd.regionDisplay = (metaB.loc && metaB.loc.display) ||
                              (metaA.loc && metaA.loc.display) || '';
        }
      }
      if (Object.keys(upd).length) {
        upd.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await doc.ref.set(upd, { merge: true });
        updated++;
      }
    }

    res.json({ ok: true, scanned: snap.size, updated });
  } catch (e) {
    console.error('backfill error', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Test INTENT
app.post('/api/wish', async (req, res) => {
  try {
    const { text, userId, userName = 'Magic User' } = req.body || {};
    const id = `test_${Date.now()}`;

    console.log('🎯 Received TEST /api/wish (INTENT):', { id, text: short(text), userId });

    if (!firebaseLoaded || !db) {
      return res.json({ success: true, message: '✨ Received (mock mode — no Firebase)', wishId: id, mode: 'mock' });
    }

    const data = {
      text: text || '',
      userId: userId || 'test_user',
      userName,
      type: 'want',
      category: 'товары',
      radiusKm: 25,
      status: 'published',
      createdAt: new Date(),
    };

    const ref = db.collection('intents').doc(id);
    await ref.set(data);

    return res.json({ success: true, message: '✨ INTENT created; listener will process it.', intentId: id, mode: 'firebase_intents' });
  } catch (error) {
    console.error('❌ /api/wish error:', error);
    res.status(500).json({ success: false, error: String(error.message || error) });
  }
});

// Test WISH (legacy)
app.post('/api/publish-wish', async (req, res) => {
  try {
    const { text, uid, scope = 'country' } = req.body || {};
    const id = `wish_${Date.now()}`;

    console.log('🎯 Received TEST /api/publish-wish (WISH):', { id, text: short(text), uid });

    if (!firebaseLoaded || !db) {
      return res.json({ success: true, message: '✨ Received (mock mode — no Firebase)', wishId: id, mode: 'mock' });
    }

    const data = { text: text || '', uid: uid || 'test_user', status: 'published', scope, createdAt: new Date() };
    const ref = db.collection('wishes').doc(id);
    await ref.set(data);

    return res.json({ success: true, message: '✨ WISH created; listener will process it.', wishId: id, mode: 'firebase_wishes' });
  } catch (error) {
    console.error('❌ /api/publish-wish error:', error);
    res.status(500).json({ success: false, error: String(error.message || error) });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    stats: { firebase: firebaseLoaded, uptime: process.uptime(), memory: process.memoryUsage(), timestamp: nowIso() },
  });
});

app.get('/api/debug-env', (req, res) => {
  res.json({
    project_id: process.env.project_id,
    client_email: process.env.client_email,
    private_key_exists: !!process.env.private_key,
    translator_provider: (process.env.TRANSLATOR_PROVIDER || 'gct').toLowerCase(),
    embeddings_enabled: embeddingsEnabled,
    embeddings_provider: (process.env.EMBEDDINGS_PROVIDER || 'vertex').toLowerCase(),
    redis_enabled: REDIS_ENABLED || REDIS_VECTOR_ENABLED,
    firebase_loaded: firebaseLoaded,
  });
});

// Translation routes (quiet provider)
app.get('/api/translator', (req, res) => {
  res.json({ provider: (process.env.TRANSLATOR_PROVIDER || 'gct').toLowerCase(), using: 'worker/translators/index.js' });
});
app.post('/api/detect', async (req, res) => {
  try {
    const { text = '' } = req.body || {};
    const lang = await translators.detectLanguage(text);
    res.json({ ok: true, lang });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
app.post('/api/translate', async (req, res) => {
  try {
    const { text = '', from = 'auto' } = req.body || {};
    const result = await translators.translateToEn(text, from);
    const out = typeof result === 'string' ? { text: result, provider: 'unknown', ms: 0 } : result;
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Embeddings selftest
app.post('/api/embeddings/selftest', async (req, res) => {
  try {
    if (!embeddingsEnabled || !embedder) {
      return res.status(400).json({ ok: false, error: 'embeddings disabled or unavailable' });
    }
    const { text = 'машина' } = req.body || {};
    const { vector, dim, model, provider, ms } = await embedder.embed(text);
    res.json({ ok: true, dim, model, provider, ms, normSample: vector?.slice(0, 6) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

const PORT = process.env.API_PORT || 3000;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
🎉 MAGIC WORKER STARTED! 🎉

📍 http://localhost:${PORT}
🔧 Firebase: ${firebaseLoaded ? '✅ CONNECTED' : '❌ NOT CONNECTED'}
👂 Listeners: INTENTS (real-only), WISHES, USERS, CONTACT_REQUESTS
✨ Embeddings: ${embeddingsEnabled && embedder ? '✅ ENABLED' : 'ℹ️ DISABLED/UNAVAILABLE'}
🧠 Vector index (Redis): ${REDIS_VECTOR_ENABLED ? 'ON' : 'OFF'}

Try:
  curl http://localhost:${PORT}/
  curl http://localhost:${PORT}/api/redis
  curl -X POST http://localhost:${PORT}/api/embeddings/selftest -H "Content-Type: application/json" -d '{"text":"машина"}'
  `);

  // init Redis (non-blocking)
  await initRedis();

  if (firebaseLoaded) setupFirestoreListeners();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down gracefully...');
  try { if (redisClient && redisReady) await redisClient.quit(); } catch {}
  process.exit(0);
});

// ====== NOTE ======
// generateMatches(): legacy branch for WISH kept; if not defined, it won't run.
//
