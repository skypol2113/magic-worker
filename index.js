// Magic Worker - ROOT (real matches only)
// =======================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const he = require('he');
const _ = require('lodash');
const translators = require('./worker/translators');
const admin = require('firebase-admin');

// ---------- Assist (OpenAI) ----------
const ASSIST_ENABLED = (process.env.ASSIST_ENABLED || 'true').toLowerCase() === 'true';
const ASSIST_ALLOW_ORIGINS = (process.env.ASSIST_ALLOW_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
const ASSIST_MODEL = process.env.ASSIST_MODEL || 'gpt-4o-mini';
const ASSIST_MAX_TOKENS = parseInt(process.env.ASSIST_MAX_TOKENS || '120', 10);
const ASSIST_TIMEOUT_MS = parseInt(process.env.ASSIST_TIMEOUT_MS || '12000', 10);

// ---------- Embeddings ----------
const EMBEDDINGS_ENABLED = (process.env.EMBEDDINGS_ENABLED || 'true') === 'true';
const EMBEDDINGS_MIN_SIM = parseFloat(process.env.EMBEDDINGS_MIN_SIM || '0.75');
const EMBEDDINGS_CANDIDATE_LIMIT = parseInt(process.env.EMBEDDINGS_CANDIDATE_LIMIT || '200', 10);
const EMBEDDINGS_TOP_K = parseInt(process.env.EMBEDDINGS_TOP_K || '5', 10);

// ---------- God-Mode & Limits ----------
const APP_MODE = process.env.APP_MODE || 'production';
const MAX_ACTIVE_INTENTS = parseInt(process.env.MAX_ACTIVE_INTENTS_PER_USER || '10', 10);
const INTENT_COOLDOWN_MS = parseInt(process.env.INTENT_PUBLISH_COOLDOWN_SEC || '60', 10) * 1000;

// Cooldown tracking (in-memory, resets on restart)
const _intentPublishCooldowns = new Map();

function checkIntentCooldown(uid) {
  const last = _intentPublishCooldowns.get(uid);
  if (!last) return true;
  const elapsed = Date.now() - last;
  return elapsed >= INTENT_COOLDOWN_MS;
}

function setIntentCooldown(uid) {
  _intentPublishCooldowns.set(uid, Date.now());
}

// ---------- Firebase ----------
const FV = admin.firestore.FieldValue;
const TS = admin.firestore.Timestamp;

let firebaseLoaded = false;
let db = null;
// ==== Project ID resolve (works with ADC) ====
let PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT ||
  process.env.project_id ||
  null;

async function resolveProjectIdOnce() {
  if (PROJECT_ID) return PROJECT_ID;
  try {
    const cred = admin.app && admin.app().options && admin.app().options.credential;
    if (cred && typeof cred.getProjectId === 'function') {
      PROJECT_ID = await cred.getProjectId();
    }
  } catch (_) {}
  return PROJECT_ID;
}

(function initFirebase() {
  try {
    // 1) Если есть локальный модуль конфигурации — используем его и выходим
    try {
      const { db: firebaseDb } = require('./config/firebase');
      if (firebaseDb && typeof firebaseDb.collection === 'function') {
        db = firebaseDb;
        firebaseLoaded = true;
        global.firestore = db;
        console.log('✅ Firebase via ./config/firebase');
        return;
      }
    } catch (_) {
      // no-op → пойдём по стандартной инициализации ниже
    }

    // 2) ADC предпочтительнее, если работаем в GCP/Cloud Run или задан путь к JSON ключу
    const preferADC =
      !!process.env.GOOGLE_APPLICATION_CREDENTIALS || // локально/в Docker через монтирование ключа
      !!process.env.K_SERVICE ||                      // Cloud Run признак
      !!process.env.GOOGLE_CLOUD_PROJECT;             // любая среда GCP

    if (!admin.apps.length) {
      if (preferADC) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
        console.log('✅ Firebase via ADC (applicationDefault)');
      } else {
        // 3) Fallback: cert(...) из переменных окружения
        const pk = String(process.env.private_key || '')
          .replace(/\\n/g, '\n')        // распространённый случай с \n в env
          .replace(/`n/g, '\n');        // на всякий случай для PowerShell
        admin.initializeApp({
          credential: admin.credential.cert({
            project_id: process.env.project_id,
            client_email: process.env.client_email,
            private_key: pk,
          }),
        });
        console.log('✅ Firebase via cert(env)');
      }
    }

    db = admin.firestore();
    firebaseLoaded = !!db;
    global.firestore = db;

    console.log('🔧 Firebase config check:');
    console.log('Project ID:', admin.app().options?.projectId || process.env.project_id || process.env.GOOGLE_CLOUD_PROJECT || 'unknown');
    console.log('Client Email:', process.env.client_email || 'n/a');
    console.log('Private Key exists:', !!process.env.private_key);
  } catch (e) {
    console.error('❌ Firebase init failed:', e);
  }
})();

// Логируем итоговый ProjectId (после initFirebase)
resolveProjectIdOnce().then(id => console.log('🆔 ProjectId:', id || '(none)'));

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json());

// CORS allow-list для ассиста (если задан)
app.use((req, res, next) => {
  if (!ASSIST_ENABLED || !ASSIST_ALLOW_ORIGINS.length) return next();
  const origin = req.headers.origin;
  if (origin && ASSIST_ALLOW_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(204).end();
  }
  next();
});

// Корреляционный ID на каждый запрос
app.use((req, res, next) => {
  const rid = (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)).toUpperCase();
  req._rid = rid;
  res.setHeader('X-Assist-Request-Id', rid);
  next();
});

// Короткий отчёт об окружении
console.log('🎯 Magic Worker');
console.log('🔧 Env:', {
  project_id: process.env.project_id,
  client_email: process.env.client_email,
  private_key: process.env.private_key ? 'EXISTS' : 'MISSING',
});
console.log('🔮 Embeddings:', {
  enabled: EMBEDDINGS_ENABLED,
  minSimilarity: EMBEDDINGS_MIN_SIM,
  candidateLimit: EMBEDDINGS_CANDIDATE_LIMIT,
  topK: EMBEDDINGS_TOP_K,
});

// ---------- Helpers ----------
const nowIso = () => new Date().toISOString();
const short = (str, n = 80) => (!str ? '' : (str.length > n ? str.slice(0, n) + '…' : str));
const dehtml = (s) => (!s ? '' : he.decode(String(s).replace(/&nbsp;/g, ' ')));

function docWasProcessed(doc) {
  const d = doc.data() || {};
  return !!d.workerProcessed || !!d.processedAt || !!d.workerVersion;
}

function get(obj, path, def = undefined) {
  return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj) ?? def;
}

async function getUserLanguage(uid) {
  try {
    const snap = await db.doc(`users_private/${uid}`).get();
    if (snap.exists) {
      const prefs = snap.data()?.preferences;
      return (prefs?.interfaceLanguage || 'en').toLowerCase();
    }
  } catch (e) {
    console.warn('getUserLanguage:', e.message || e);
  }
  return 'en';
}

async function translateIfNeeded(text, sourceLang, targetLang) {
  const from = (sourceLang || 'auto').toLowerCase();
  const to = (targetLang || 'en').toLowerCase();
  if (!text || to === from) return text || '';
  try {
    const r = await translators.translate(text, to, from);
    return r?.text ?? text;
  } catch (e) {
    console.warn('translateIfNeeded:', e.message || e);
    return text;
  }
}

// ---------- Rate limit для ассиста ----------
const _assistBuckets = new Map(); // key -> { tokens, refillAt }
function _assistAllow(key, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  let b = _assistBuckets.get(key);
  if (!b) {
    _assistBuckets.set(key, { tokens: limit - 1, refillAt: now + windowMs });
    return true;
  }
  if (now > b.refillAt) {
    b.tokens = limit - 1;
    b.refillAt = now + windowMs;
    return true;
  }
  if (b.tokens > 0) { b.tokens -= 1; return true; }
  return false;
}

// ---------- Assist: OpenAI ----------
function _cleanSuggestions(arr) {
  const out = [];
  const seen = new Set();
  for (let s of arr || []) {
    if (typeof s !== 'string') continue;
    s = he.decode(s).trim().replace(/\s+/g, ' ');
    if (!s) continue;
    if (s.length > 240) s = s.slice(0, 240).trim();
    s = s.replace(/^\s*[\d-]+\s*[.)]\s*/, '').replace(/^["'«»]+|["'«»]+$/g, '');
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

async function _openaiAssistContinue({ text, lang }) {
  if (!OPENAI_API_KEY) return null;

  const body = {
    model: ASSIST_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an AI writing assistant helping users refine their wish/offer text for MagicAIbox platform. ' +
          'Given user input, provide 3-5 alternative phrasings that express THE EXACT SAME wish more clearly. ' +
          'Rules: ' +
          '1. PRESERVE intent direction: "want to sell X" stays "selling X", "want to learn Y" stays "learning Y", "can help with Z" stays "helping with Z". ' +
          '2. Only rephrase for clarity, add helpful details, or improve grammar. ' +
          '3. Each variant must include semantic facets/tags (e.g., "продажа", "обучение", "техника"). ' +
          'Output JSON: {"suggestions":[{"text":"...","facets":["...","..."]},...]}. ' +
          'Language must match input.',
      },
      {
        role: 'user',
        content: `User wrote: "${text}"\nLanguage: ${lang || 'auto'}\n\nProvide 3-5 rephrased versions (same meaning, better wording) as JSON.`,
      },
    ],
    max_tokens: ASSIST_MAX_TOKENS + 50,
    temperature: 0.7,
    n: 1,
    response_format: { type: 'json_object' },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ASSIST_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`OpenAI ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '{"suggestions":[]}';
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error('OpenAI JSON parse error:', parseErr.message, '| content preview:', content.slice(0, 200));
      // Fallback: попытка извлечь JSON из текста
      try {
        const m = content.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : { suggestions: [] };
      } catch (fallbackErr) {
        console.error('Fallback JSON parse also failed:', fallbackErr.message);
        return [];
      }
    }
    
    const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    
    // Нормализация: если пришёл массив строк, оборачиваем в объекты
    const normalized = suggestions.map(s => {
      if (typeof s === 'string') return { text: s, facets: [] };
      return { text: s.text || '', facets: Array.isArray(s.facets) ? s.facets : [] };
    });

    return normalized.filter(s => s.text.length >= 10);
  } finally {
    clearTimeout(t);
  }
}

// кэш на 60с
const _assistCache = new Map();
const _assistCacheTTL = 60_000;
const _hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const _cacheGet = (k) => {
  const v = _assistCache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > _assistCacheTTL) { _assistCache.delete(k); return null; }
  return v.data;
};
const _cacheSet = (k, data) => _assistCache.set(k, { ts: Date.now(), data });

// Универсальный ассист-хендлер (роуты подключишь ниже)
async function _assistHandler(req, res) {
  const t0 = Date.now();
  try {
    if (!ASSIST_ENABLED) return res.status(503).json({ ok: false, error: 'assist_disabled' });

    const origin = req.headers.origin;
    if (ASSIST_ALLOW_ORIGINS.length && origin && !ASSIST_ALLOW_ORIGINS.includes(origin)) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }

    const { text = '', lang = 'auto', uid } = req.body || {};
    const cleaned = dehtml(text).trim();
    if (cleaned.length < 12) return res.status(400).json({ ok: false, error: 'text_too_short' });

    const key = uid ? `u:${uid}` : `ip:${req.ip}`;
    if (!_assistAllow(key, 8, 60_000)) return res.status(429).json({ ok: false, error: 'rate_limited' });

    if (!OPENAI_API_KEY) return res.status(503).json({ ok: false, error: 'no_ai_provider' });

    const cacheKey = _hash(`v6|${lang}|${cleaned}`);
    const cached = _cacheGet(cacheKey);
    if (cached) return res.json({ ok: true, items: cached, cached: true, ms: Date.now() - t0, godMode: APP_MODE === 'god' });

    const items = await _openaiAssistContinue({ text: cleaned, lang });
    if (!Array.isArray(items) || !items.length) return res.status(204).end();

    _cacheSet(cacheKey, items);
    console.log(`💡 [${req._rid}] assist ${items.length} in ${Date.now() - t0}ms`);
    return res.json({ ok: true, items, ms: Date.now() - t0, godMode: APP_MODE === 'god' });
  } catch (e) {
    const msg = e?.message || String(e);
    const isAbort = /aborted|AbortError|The operation was aborted/i.test(msg);
    return res.status(isAbort ? 504 : 500).json({ ok: false, error: msg, ms: Date.now() - t0 });
  }
}

// --- Health endpoints (drop-in replacement for your current /healthz block) ---
function buildHealthPayload() {
  return {
    ok: true,
    time: new Date().toISOString(),
    projectId:
      (admin.app && admin.app().options?.projectId) ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT ||
      process.env.project_id ||
      null,
    assistEnabled: ASSIST_ENABLED,
    hasOpenAIKey: !!OPENAI_API_KEY,
    assistModel: ASSIST_MODEL,
    embeddings: {
      enabled: EMBEDDINGS_ENABLED,
      minSim: EMBEDDINGS_MIN_SIM,
      topK: EMBEDDINGS_TOP_K,
    },
  };
}

// Один обработчик на два пути — и /health, и /healthz
app.get(['/health', '/healthz'], (req, res) => {
  res.status(200).json(buildHealthPayload());
});

// ---------- Нормализация и матчинг ----------
function pairKey(aUid, bUid, aIntentId, bIntentId) {
  const uids = [aUid || '', bUid || ''].sort().join('|');
  const intents = [aIntentId || '', bIntentId || ''].sort().join('|');
  return crypto.createHash('sha256').update(`intent|${uids}|${intents}`).digest('hex').slice(0, 16);
}

async function getNormalizedText(docRef, docData) {
  if (docData.normalized?.text) return docData.normalized.text;
  await ensureNormalized(docRef, docData);
  const updated = await docRef.get();
  return updated.data()?.normalized?.text || docData.text || '';
}

async function detectCategories(normalizedText) {
  if (EMBEDDINGS_ENABLED && translators?.classifyText) {
    try {
      const category = await translators.classifyText(normalizedText);
      if (category) return [category];
    } catch (e) {
      // fall back
    }
  }
  const t = (normalizedText || '').toLowerCase();
  if (/(car|auto|vehicle|bmw|toyota|mercedes|tesla)/i.test(t)) return ['auto'];
  const cats = [];
  if (/(learn|study|teach|education|course)/i.test(t)) cats.push('learning');
  if (/(friend|meet|people|social|connection)/i.test(t)) cats.push('social');
  if (/(travel|trip|journey|adventure)/i.test(t)) cats.push('travel');
  if (/(health|fitness|sport|exercise|yoga)/i.test(t)) cats.push('health');
  if (/(music|art|movie|entertainment|fun)/i.test(t)) cats.push('entertainment');
  return cats.length ? cats : ['general'];
}

function getMagicType(category) {
  const map = {
    auto: 'market',
    learning: 'knowledge',
    social: 'connection',
    travel: 'adventure',
    health: 'vitality',
    entertainment: 'fun',
    general: 'magic',
  };
  return map[category] || 'magic';
}

function generateMatchText(normalizedText, category) {
  const t = (normalizedText || '').trim();
  const key = t ? t.split(/\s+/).slice(0, 2).join(' ') : 'interest';
  const templates = {
    learning: `I also want to learn: ${key}`,
    social: `Looking for company for: ${key}`,
    travel: `Dreaming about trip: ${key}`,
    auto: `Interested in cars: ${key}`,
    default: `I'm also interested in: ${key}`,
  };
  return templates[category] || templates.default;
}

async function selectCounterpartsForIntent(srcId, srcData, limit = EMBEDDINGS_TOP_K) {
  // если уже есть матч — не плодим дубликаты
  try {
    const existing = await db.collection('matches').where('aIntentId', '==', srcId).limit(1).get();
    if (!existing.empty) return [];
  } catch (e) {
    // continue
  }

  const srcRef = db.collection('intents').doc(srcId);
  const text = await getNormalizedText(srcRef, srcData);
  if (!text.trim()) return [];

  const me = srcData.userId;
  const snap = await db.collection('intents')
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(EMBEDDINGS_CANDIDATE_LIMIT)
    .get();

  const processed = new Set();
  const jobs = [];

  snap.forEach((d) => {
    if (d.id === srcId) return;
    const x = d.data() || {};
    if (!x.userId || x.userId === me) return;
    if (processed.has(d.id)) return;
    processed.add(d.id);

    jobs.push((async () => {
      try {
        const targetRef = db.collection('intents').doc(d.id);
        const targetText = await getNormalizedText(targetRef, x);
        if (!targetText.trim()) return null;

        if (EMBEDDINGS_ENABLED) {
          const score = await translators.semanticSimilarity(text, targetText);
          if (score >= EMBEDDINGS_MIN_SIM) {
            return { id: d.id, ...x, score, matchType: 'semantic', semanticMatch: true };
          }
          return null;
        }

        // fallback по ключевым словам — только если эмбеддинги отключены
        const tl = text.toLowerCase();
        const ul = targetText.toLowerCase();
        let keywordScore = 0;
        if (tl && ul.includes(tl)) keywordScore = 0.75;
        else if (tl.includes('car') && ul.includes('car')) keywordScore = 0.78;
        else if (tl.includes('auto') && ul.includes('auto')) keywordScore = 0.76;

        if (keywordScore >= 0.75) {
          return { id: d.id, ...x, score: keywordScore, matchType: 'keyword', semanticMatch: false };
        }
        return null;
      } catch {
        return null;
      }
    })());
  });

  const results = (await Promise.all(jobs)).filter(Boolean).sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

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
    await db.collection('audit_events').add({ type: 'sign_up', uid, createdAt: now, version: 1 });
  } else {
    await ref.set({ updatedAt: now, ...seed }, { merge: true });
  }
}

async function getUserSafeSnapshot(uid) {
  const [pubSnap, privSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`users_private/${uid}`).get(),
  ]);
  const u = pubSnap.exists ? (pubSnap.data() || {}) : {};
  const p = privSnap.exists ? (privSnap.data() || {}) : {};

  const loc = u.loc || {};
  const anchor = u.anchor || {};
  const admin2 = (loc.district || loc.admin2 || u.admin2 || '') || null;
  const city = (loc.city || u.city || anchor.city || '') || null;
  const country = (u.country || loc.countryName || loc.country || anchor.country || '') || null;
  const display = [admin2, city, country].filter(Boolean).join(' • ') || null;

  return {
    displayName: u.displayName ?? '',
    photoURL: u.photoURL ?? null,
    loc: { admin2, city, country, display },
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
    const priv = await db.doc(`users_private/${uid}`).get();
    const devices = (priv.exists ? priv.get('devices') : []) || [];
    const tokens = Array.isArray(devices)
      ? Array.from(new Set(devices.map(d => d && d.fcmToken).filter(Boolean)))
      : [];
    if (!tokens.length) return;

    const msg = { tokens, notification: payload.notification || undefined, data: payload.data || {} };
    const resp = await admin.messaging().sendEachForMulticast(msg);

    const bad = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          bad.push(tokens[i]);
        }
      }
    });

    if (bad.length) {
      await db.doc(`users_private/${uid}`).set({
        devices: FV.arrayRemove(...devices.filter(d => bad.includes(d.fcmToken)))
      }, { merge: true });
    }
  } catch (e) {
    console.error('sendPushToUser:', e);
  }
}

async function readPublicMeta(uid) {
  try {
    const snap = await db.doc(`users/${uid}`).get();
    const u = snap.exists ? (snap.data() || {}) : {};
    const loc = u.loc || {};
    const anchor = u.anchor || {};

    const admin2 = (loc.district || loc.admin2 || u.admin2 || '').toString();
    const city = (loc.city || u.city || anchor.city || '').toString();
    const country = (u.country || loc.countryName || loc.country || anchor.country || '').toString();

    const parts = [];
    if (admin2) parts.push(admin2);
    if (city) parts.push(city);
    if (country) parts.push(country);
    const display = parts.filter(Boolean).join(' • ');

    return {
      text: (u.lastIntentText || '').toString(),
      loc: {
        admin2: admin2 || null,
        city: city || null,
        country: country || null,
        lat: typeof anchor.lat === 'number' ? anchor.lat : null,
        lng: typeof anchor.lng === 'number' ? anchor.lng : null,
        display: display || null,
      },
    };
  } catch {
    return { text: '', loc: {} };
  }
}

async function ensureNormalized(docRef, doc) {
  const raw = doc.text || '';
  const text = dehtml(raw);
  if (!text.trim()) return;

  const already = _.get(doc, 'normalized.text');
  const lastSrc = _.get(doc, 'normalized._sourceText');
  if (already && lastSrc === raw) return;

  let detected = doc.lang && doc.lang !== 'auto' ? doc.lang : null;
  try {
    if (!detected) detected = await translators.detectLanguage(text);
  } catch {
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
    } catch {
      normalizedText = text;
      translated = false;
    }
  }

  await docRef.set({
    normalized: {
      lang: 'en',
      text: normalizedText,
      detectedLang: detected || 'und',
      translated,
      provider,
      providerMs,
      _sourceText: raw,
      updatedAt: FV.serverTimestamp(),
    },
  }, { merge: true });

  const targets = (process.env.TARGET_LOCALES || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  if (targets.length) {
    const detectedLang = (detected || 'und').toLowerCase();
    const srcText = raw;
    const enText = normalizedText;

    const translations = {};
    for (const lang of targets) {
      try {
        if (lang === 'en') {
          translations['en'] = { text: enText, provider, ms: providerMs };
          continue;
        }
        if (detectedLang !== 'und' && lang === detectedLang) {
          translations[lang] = { text: srcText, provider: 'origin', ms: 0 };
          continue;
        }
        const r = await translators.translate(srcText, lang, detectedLang || 'auto');
        translations[lang] = { text: r.text || srcText, provider: r.provider || 'gct', ms: r.ms || 0 };
      } catch {
        // skip failed lang
      }
    }

    if (Object.keys(translations).length) {
      await docRef.set({ normalized: { translations, _sourceText: srcText } }, { merge: true });
    }
  }
}

const MATCH_TOP_N = parseInt(process.env.MATCH_TOP_N || '1', 10);

async function processGenericDoc(kind, doc) {
  const data = doc.data() || {};
  if (!data) return;

  const textRaw = data.text || '';
  const status = data.status;
  console.log(`🔮 Processing ${kind}:`, { id: doc.id, status, uid: data.userId || data.uid || 'unknown', text: short(textRaw, 60) });

  await new Promise((r) => setTimeout(r, 300));

  const isIntent = kind === 'INTENT';
  const parentRef = isIntent ? db.collection('intents').doc(doc.id) : db.collection('wishes').doc(doc.id);

  try { await ensureNormalized(parentRef, data); } catch (e) { console.warn('normalize:', e.message || e); }

  if (isIntent) {
    const updatedSnap = await parentRef.get();
    const currentData = updatedSnap.data() || {};
    const normalizedText = currentData.normalized?.text || textRaw;

    const cps = await selectCounterpartsForIntent(doc.id, currentData, MATCH_TOP_N);

    const batch = db.batch();
    const createdIds = [];
    const notifiedBUsers = [];

    const metaA = await readPublicMeta(currentData.userId).catch(() => ({ loc: {}, text: '' }));
    const pickLoc = (loc) => ({
      admin2: loc?.admin2 ?? null,
      city: loc?.city ?? null,
      country: loc?.country ?? null,
      display: loc?.display ?? null,
    });

    if (cps.length) {
      for (const c of cps.slice(0, MATCH_TOP_N)) {
        const pk = pairKey(currentData.userId, c.userId, doc.id, c.id);
        const mRef = db.collection('matches').doc(pk);
        const dup = await mRef.get();
        if (dup.exists) continue;

        const category = (await detectCategories(normalizedText))[0] || 'general';
        const metaB = await readPublicMeta(c.userId).catch(() => ({ loc: {}, text: '' }));
        const aLoc = pickLoc(metaA.loc || {});
        const bLoc = pickLoc(metaB.loc || {});
        const regionDisplay = (bLoc.display?.trim()) || (aLoc.display?.trim()) || (c.regionDisplay || '') || '';

        const usersArray = [currentData.userId, c.userId].filter(Boolean);
        if (usersArray.length < 2) continue;

        const matchData = {
          aUid: currentData.userId,
          bUid: c.userId,
          users: usersArray,
          participants: usersArray,

          aIntentId: doc.id,
          bIntentId: c.id,

          aText: (textRaw || ''),
          bText: (c.text || ''),

          aLoc, bLoc, regionDisplay,

          aCreatedAt: currentData.createdAt || FV.serverTimestamp(),
          bCreatedAt: c.createdAt || FV.serverTimestamp(),

          matchedText: generateMatchText(normalizedText, category),
          category,
          magicType: getMagicType(category),
          matchType: c.matchType || 'semantic',
          similarity: c.score,
          score: c.score,
          confidence: Math.min(0.95, (c.score || 0) + 0.05),

          approxDistanceKm: null,

          pairKey: pk,
          appId: 'com.magicai.box',
          source: 'intent',
          status: 'new',
          createdAt: FV.serverTimestamp(),
          updatedAt: FV.serverTimestamp(),
        };

        batch.set(mRef, matchData, { merge: false });
        createdIds.push(pk);
        notifiedBUsers.push(c.userId);
      }
    }

    batch.update(parentRef, {
      processedAt: FV.serverTimestamp(),
      workerProcessed: true,
      matchesCount: createdIds.length,
      workerVersion: 'magicbox-worker-2.0',
      workerLastRun: nowIso(),
    });

    await batch.commit();

    if (createdIds.length) {
      try {
        const initiatorLanguage = (await getUserLanguage(currentData.userId)) || 'en';
        const initiatorTitle = await translateIfNeeded('Match found', 'en', initiatorLanguage);
        const initiatorBody  = await translateIfNeeded('You have a new match', 'en', initiatorLanguage);

        await sendPushToUser(currentData.userId, {
          notification: { title: initiatorTitle, body: initiatorBody },
          data: { type: 'match_new' },
        });

        for (const bUid of notifiedBUsers) {
          const opponentLanguage = (await getUserLanguage(bUid)) || 'en';
          const opponentTitle = await translateIfNeeded('You were matched', 'en', opponentLanguage);
          const opponentBody  = await translateIfNeeded('You have a new match', 'en', opponentLanguage);

          await sendPushToUser(bUid, {
            notification: { title: opponentTitle, body: opponentBody },
            data: { type: 'match_new' },
          });
        }

        const deliveredUids = [currentData.userId, ...notifiedBUsers];
        await Promise.all(
          createdIds.map((mid) =>
            db.doc(`matches/${mid}`).set(
              {
                deliveredTo: FV.arrayUnion(...deliveredUids),
                deliveredAt: FV.serverTimestamp(),
                updatedAt: FV.serverTimestamp(),
              },
              { merge: true },
            ),
          ),
        );
      } catch (e) {
        console.warn('push match_new:', e.message || e);
      }
    }
  } else {
    // WISH: синтетические матчи отключены — только маркируем обработку
    await db.collection('wishes').doc(doc.id).set({
      processedAt: FV.serverTimestamp(),
      workerProcessed: true,
      matchesCount: 0,
      workerVersion: 'magicbox-worker-2.0',
      workerLastRun: nowIso(),
    }, { merge: true });
  }
}
// ==============================
// Watchers / Listeners / Routes
// ==============================

// --- Deactivate all matches when an intent is unpublished/removed
async function deactivateMatchesForIntent(intentId, reason = 'intent_removed') {
  if (!intentId) return;

  const LIMIT = 300;
  let total = 0;

  async function deactivateSide(sideField) {
    let last = null;
    while (true) {
      let q = db.collection('matches').where(sideField, '==', intentId).limit(LIMIT);
      if (last) q = q.startAfter(last);

      const snap = await q.get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => {
        const m = d.data() || {};
        const a = m.aUid, b = m.bUid;
        const closedBySide =
          m.aIntentId === intentId ? 'a' :
          m.bIntentId === intentId ? 'b' : null;
        const closedByUid = closedBySide === 'a' ? a : closedBySide === 'b' ? b : null;

        batch.set(d.ref, {
          status: 'void',
          closedReason: reason || 'intent_unpublished_or_deleted',
          closedBySide,
          closedByUid: closedByUid || null,
          showVoidBanner: true,
          archivedAt: FV.serverTimestamp(),
          updatedAt: FV.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();

      total += snap.size;
      last = snap.docs[snap.docs.length - 1];
    }
  }

  await deactivateSide('aIntentId');
  await deactivateSide('bIntentId');

  console.log(`🧹 Deactivated ${total} matches for intent ${intentId} (${reason})`);
}

// --- Generic Firestore listener with de-dup + removal handling
function setupListener(collectionName, kind) {
  console.log(`🔍 Listener: ${collectionName} (status='published')`);
  return db.collection(collectionName)
    .where('status', '==', 'published')
    .onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const { type, doc } = change;

          // For intents: "removed" = doc deleted or status changed away from 'published'
          if (kind === 'INTENT' && type === 'removed') {
            deactivateMatchesForIntent(doc.id, 'intent_unpublished_or_deleted')
              .catch(e => console.error('deactivate error:', e));
            return;
          }

          if (type !== 'added' && type !== 'modified') return;
          if (docWasProcessed(doc)) return;
          if ((doc.data() || {}).status !== 'published') return;

          const processKey = `${kind}_${doc.id}`;
          global.processingQueue = global.processingQueue || {};
          if (global.processingQueue[processKey]) return;

          global.processingQueue[processKey] = true;
          processGenericDoc(kind, doc)
            .catch((e) => console.error(`process ${kind} error:`, e))
            .finally(() => {
              setTimeout(() => {
                if (global.processingQueue) delete global.processingQueue[processKey];
              }, 5000);
            });
        });
      },
      (error) => console.error(`${collectionName} listener error:`, error)
    );
}

// --- INTENTS watcher (simple language inference for new drafts)
// note: only for non-published docs observed by the raw collection stream
function setupIntentsLanguageWatcher() {
  console.log('💬 INTENTS language watcher');
  return db.collection('intents').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;

        const doc = change.doc;
        const data = doc.data() || {};
        const uid = data.userId;
        const intentText = data.text;
        const status = data.status;

        // we only infer language for non-published drafts
        if (status === 'published') return;
        if (!uid || !intentText) return;

        try {
          const detected = await translators.detectLanguage(intentText);
          if (detected && detected !== 'und') {
            const privRef = db.collection('users_private').doc(uid);
            await privRef.set({
              preferences: {
                interfaceLanguage: detected,
                autoTranslate: true,
                detectedAt: FV.serverTimestamp(),
                detectedFrom: 'intent',
              },
              updatedAt: FV.serverTimestamp(),
            }, { merge: true });

            await db.collection('users').doc(uid).set({
              lastIntentText: intentText,
              updatedAt: FV.serverTimestamp(),
            }, { merge: true });
          }
        } catch (e) {
          console.error('INTENTS language update failed:', e);
        }
      });
    },
    (error) => console.error('INTENTS language watcher error:', error)
  );
}

// --- USERS watcher (mirrors tokens into users_private.devices[])
function setupUsersWatcher() {
  console.log('👤 USERS watcher');
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
          console.log(`✅ users_private ${uid} ${isNew ? 'created' : 'updated'}`);
        } catch (e) {
          console.error('USERS watcher error:', e);
        }
      });
    },
    (error) => console.error('USERS watcher stream error:', error)
  );
}

// --- CONTACT_REQUESTS watcher → write contact_snapshot + push
function setupContactRequestsWatcher() {
  console.log('🤝 CONTACT_REQUESTS watcher');
  return db.collection('contact_requests').onSnapshot(async (snap) => {
    for (const ch of snap.docChanges()) {
      // added → notify recipient
      if (ch.type === 'added') {
        const after = ch.doc.data() || {};
        const status = after.status;
        const toUid   = after.toUid || after.recipientId;
        const matchId = after.matchId;

        if (status === 'pending' && toUid && matchId) {
          try {
            await sendPushToUser(toUid, {
              notification: { title: 'Запрос контакта', body: 'Пользователь запросил ваши контакты' },
              data: { type: 'contact_request_new', matchId, requestId: ch.doc.id },
            });

            await db.doc(`matches/${matchId}`).set({
              deliveredTo: FV.arrayUnion(toUid),
              updatedAt: FV.serverTimestamp(),
            }, { merge: true });
          } catch (e) {
            console.warn('contact_request pending push warn:', e.message || e);
          }
        }
        continue;
      }

      // modified → accepted / declined
      if (ch.type !== 'modified') continue;

      const after = ch.doc.data() || {};
      const before = ch.oldIndex >= 0 ? snap.docs[ch.oldIndex]?.data() : null;
      if (!before || before.status === after.status) continue;

      const status = after.status;
      const fromUid = after.requesterId || after.fromUid;
      const toUid   = after.recipientId || after.toUid;
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
            snapshot: { shared: Object.keys(safe.contacts || {}).filter((k) => safe.contacts[k]) },
            createdAt: FV.serverTimestamp(),
            version: 1,
          });

          console.log('✅ contact accepted', { matchId, requestId: ch.doc.id });
        } catch (e) {
          console.error('contact acceptance handling error:', e);
        }
      }

      if (status === 'declined') {
        await sendPushToUser(fromUid, {
          notification: { title: 'Запрос отклонён', body: 'Контакты не были предоставлены' },
          data: { type: 'contact_request_declined', matchId, requestId: ch.doc.id },
        });
        console.log('ℹ️ contact declined', { matchId, requestId: ch.doc.id });
      }
    }
  }, (err) => console.error('CONTACT_REQUESTS watcher error:', err));
}

// --- Bundle setup
function setupFirestoreListeners() {
  if (!db) {
    console.log('❌ Firebase not available — listeners disabled');
    return;
  }
  setupListener('intents', 'INTENT');
  setupListener('wishes', 'WISH');
  setupUsersWatcher();
  setupIntentsLanguageWatcher();
  setupContactRequestsWatcher();
  console.log('✅ Firestore listeners: INTENTS, WISHES, USERS, INTENTS_LANGUAGE, CONTACT_REQUESTS');
}

// ----------------- HTTP API -----------------

// Root (compact status)
app.get('/', (req, res) => {
  res.json({
    message: '🔮 Magic Worker',
    status: 'running',
    firebase: firebaseLoaded ? 'connected' : 'not connected',
    features: [
      'intents & wishes listeners',
      'real matching only',
      'users_private bootstrap',
      'contact_requests → contact_snapshot',
      'normalization before matching',
      'intent deactivation cleanup',
    ],
    endpoints: [
      'GET  /',
      'GET  /healthz',
      'POST /api/wish',
      'POST /api/publish-wish',
      'POST /api/assist/continue',
      'POST /api/assist/feedback',
      'GET  /api/stats',
      'GET  /api/debug-env',
    ],
  });
});

// Minimal test endpoints to drive listeners from PowerShell
app.post('/api/wish', async (req, res) => {
  try {
    const { text, userId, userName = 'Magic User' } = req.body || {};
    const uid = userId || 'test_user';

    // Проверка cooldown
    if (!checkIntentCooldown(uid)) {
      const remaining = Math.ceil((INTENT_COOLDOWN_MS - (Date.now() - _intentPublishCooldowns.get(uid))) / 1000);
      return res.status(429).json({ 
        success: false, 
        error: 'cooldown_active',
        message: `Please wait ${remaining} seconds before publishing another intent`,
        remainingSeconds: remaining
      });
    }

    // Проверка лимита активных интентов
    if (firebaseLoaded && db) {
      const activeSnap = await db.collection('intents')
        .where('userId', '==', uid)
        .where('status', '==', 'published')
        .get();
      
      if (activeSnap.size >= MAX_ACTIVE_INTENTS) {
        return res.status(429).json({
          success: false,
          error: 'too_many_intents',
          message: `You have reached the limit of ${MAX_ACTIVE_INTENTS} active intents. Please complete or archive some first.`,
          activeCount: activeSnap.size,
          maxAllowed: MAX_ACTIVE_INTENTS
        });
      }
    }

    const id = `test_${Date.now()}`;

    if (!firebaseLoaded || !db) {
      return res.json({ success: true, message: 'received (mock mode — no Firebase)', intentId: id, mode: 'mock' });
    }

    const data = {
      text: text || '',
      userId: uid,
      userName,
      type: 'want',
      status: 'published',
      createdAt: new Date(),
    };

    await db.collection('intents').doc(id).set(data);
    setIntentCooldown(uid);
    
    return res.json({ 
      success: true, 
      message: 'INTENT created; listener will process it', 
      intentId: id, 
      mode: 'firebase_intents',
      godMode: APP_MODE === 'god'
    });
  } catch (e) {
    console.error('/api/wish error:', e);
    res.status(500).json({ success: false, error: String(e.message || e) });
  }
});

app.post('/api/publish-wish', async (req, res) => {
  try {
    const { text, uid, scope = 'country' } = req.body || {};
    const id = `wish_${Date.now()}`;

    if (!firebaseLoaded || !db) {
      return res.json({ success: true, message: 'received (mock mode — no Firebase)', wishId: id, mode: 'mock' });
    }

    await db.collection('wishes').doc(id).set({
      text: text || '',
      uid: uid || 'test_user',
      status: 'published',
      scope,
      createdAt: new Date(),
    });

    return res.json({ success: true, message: 'WISH created; listener will process it', wishId: id, mode: 'firebase_wishes' });
  } catch (e) {
    console.error('/api/publish-wish error:', e);
    res.status(500).json({ success: false, error: String(e.message || e) });
  }
});

// Assist: continue/refine wish text (UI taps the ✨)
app.post('/api/assist/continue', _assistHandler);

// User stats for UI indicators (limits, cooldown, god-mode)
app.get('/api/user/stats', async (req, res) => {
  try {
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ ok: false, error: 'uid_required' });

    if (!firebaseLoaded || !db) {
      return res.json({ ok: true, activeIntents: 0, maxIntents: MAX_ACTIVE_INTENTS, godMode: APP_MODE === 'god', cooldownRemaining: 0 });
    }

    const activeSnap = await db.collection('intents')
      .where('userId', '==', uid)
      .where('status', '==', 'published')
      .get();

    const lastPublish = _intentPublishCooldowns.get(uid);
    const cooldownRemaining = lastPublish 
      ? Math.max(0, Math.ceil((INTENT_COOLDOWN_MS - (Date.now() - lastPublish)) / 1000))
      : 0;

    return res.json({
      ok: true,
      activeIntents: activeSnap.size,
      maxIntents: MAX_ACTIVE_INTENTS,
      cooldownRemaining,
      godMode: APP_MODE === 'god',
      limits: {
        intents: `${activeSnap.size}/${MAX_ACTIVE_INTENTS}`,
        nextPublishIn: cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'available'
      }
    });
  } catch (e) {
    console.error('/api/user/stats error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Match translation endpoint with caching
app.post('/api/match/translate', async (req, res) => {
  try {
    const { matchId, targetLang = 'en', field = 'bText' } = req.body || {};
    
    if (!matchId) return res.status(400).json({ ok: false, error: 'matchId_required' });
    if (!firebaseLoaded || !db) return res.status(503).json({ ok: false, error: 'firebase_unavailable' });

    const mRef = db.collection('matches').doc(matchId);
    const mSnap = await mRef.get();
    
    if (!mSnap.exists) return res.status(404).json({ ok: false, error: 'match_not_found' });

    const match = mSnap.data() || {};
    const textToTranslate = match[field] || '';
    
    if (!textToTranslate) {
      return res.status(400).json({ ok: false, error: 'text_empty' });
    }

    // Check cache
    const cached = match.translations?.[field]?.[targetLang];
    
    if (cached) {
      return res.json({ ok: true, translated: cached, cached: true, targetLang });
    }

    // Translate
    const translated = await translators.translate(textToTranslate, targetLang);
    
    // Save to cache
    await mRef.set({
      translations: {
        [field]: {
          [targetLang]: translated
        }
      },
      updatedAt: FV.serverTimestamp()
    }, { merge: true });

    return res.json({ ok: true, translated, cached: false, targetLang });
  } catch (e) {
    console.error('/api/match/translate error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ===== Assist feedback (self-learning) =====
app.post('/api/assist/feedback', async (req, res) => {
  try {
    if (!firestore) return res.status(503).json({ ok:false, error:'firestore_unavailable' });

    const { uid, lang='auto', base='', action, edited=false, editRatio=0, tokenKey=null } = req.body||{};
    if (!base || !action) return res.status(400).json({ ok:false, error:'bad_args' });

    const deltas = { insert: 2, copy: 1, dismiss: -1 };
    let delta = deltas[action] ?? 0;
    if (action === 'insert' && edited) delta += (editRatio < 0.2 ? +0.5 : -0.5);

    const _hash = (s) => require('crypto').createHash('sha1').update(String(s)).digest('hex');

    async function _aggStat(docPath, delta, now) {
      const ref = firestore.doc(docPath);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data() : { score: 0, n: 0, updatedAt: now };
        const days = Math.max(0, (now - (prev.updatedAt||now)) / 86_400_000);
        const decay = Math.pow(0.9, days);
        const score = (prev.score * decay) + delta;
        tx.set(ref, { score, n: (prev.n||0)+1, updatedAt: now }, { merge: true });
      });
    }

    async function _logEvent(uid, payload) {
      try {
        const id = uid ? uid : `anon:${_hash((payload.lang||'') + (payload.base||''))}`;
        const col = firestore.collection(`assist_feedback/${id}/${new Date().toISOString().slice(0,10)}`);
        await col.add(payload);
      } catch {}
    }

    const baseKey = _hash(`${lang}|${String(base).trim()}`);
    const now = Date.now();
    await _aggStat(`assist_stats/${baseKey}`, delta, now);
    if (tokenKey) {
      const tokKey = _hash(`${lang}|${String(base).trim()}|${tokenKey}`);
      await _aggStat(`assist_stats/${tokKey}`, delta, now);
    }
    await _logEvent(uid, { lang, base, action, tokenKey, edited, editRatio, ts: now });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e.message||e) });
  }
});

// Diagnostics
app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    stats: {
      firebase: firebaseLoaded,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    },
  });
});

app.get('/api/debug-env', (req, res) => {
  res.json({
    project_id: process.env.project_id,
    client_email: process.env.client_email,
    private_key_exists: !!process.env.private_key,
    translator_provider: (process.env.TRANSLATOR_PROVIDER || 'gct').toLowerCase(),
    firebase_loaded: firebaseLoaded,
    assist_enabled: ASSIST_ENABLED,
    openai_key: !!OPENAI_API_KEY,
  });
});

// Translator debug (optional)
app.get('/api/translator', (req, res) => {
  res.json({ provider: (process.env.TRANSLATOR_PROVIDER || 'gct').toLowerCase(), module: 'worker/translators' });
});

app.post('/api/detect', async (req, res) => {
  try {
    const { text = '' } = req.body || {};
    if (!translators?.detectLanguage) return res.status(500).json({ ok: false, error: 'detectLanguage not available' });
    const lang = await translators.detectLanguage(text);
    res.json({ ok: true, lang });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/translate', async (req, res) => {
  try {
    const { text = '', from = 'auto' } = req.body || {};
    if (!translators?.translateToEn) return res.status(500).json({ ok: false, error: 'translateToEn not available' });
    const result = await translators.translateToEn(text, from);
    const out = typeof result === 'string' ? { text: result, provider: 'unknown', ms: 0 } : result;
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Embeddings debug endpoints (optional, lightweight)
app.get('/api/embeddings/status', (req, res) => {
  res.json({
    enabled: EMBEDDINGS_ENABLED,
    provider: (process.env.EMBEDDINGS_PROVIDER || 'vertex').toLowerCase(),
    project: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || null,
    location: process.env.VERTEX_LOCATION || 'us-central1',
    minSim: EMBEDDINGS_MIN_SIM,
    topK: EMBEDDINGS_TOP_K,
  });
});

app.post('/api/embeddings/embed', async (req, res) => {
  try {
    const { text = '' } = req.body || {};
    const v = await translators.getEmbedding(text);
    res.json({ ok: true, dim: v.length, preview: v.slice(0, 8) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/embeddings/similarity', async (req, res) => {
  try {
    const { a = '', b = '' } = req.body || {};
    const sim = await translators.semanticSimilarity(a, b);
    res.json({ ok: true, similarity: sim });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ----------------- Server start -----------------
const PORT = process.env.API_PORT || 3000;

async function startServer() {
  try {
    if (!firebaseLoaded) {
      // небольшая задержка, если инициализация идёт асинхронно
      await new Promise((r) => setTimeout(r, 300));
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎉 MAGIC WORKER STARTED at http://localhost:${PORT}`);
      console.log(`🔧 Firebase: ${firebaseLoaded ? 'connected' : 'not connected'}`);
      if (firebaseLoaded) {
        setupFirestoreListeners();
        console.log('✅ Firestore listeners activated');
      }
    });

    const graceful = () => {
      console.log('🔄 Shutdown signal, closing...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.log('❌ Force exit');
        process.exit(1);
      }, 10_000);
    };
    process.on('SIGINT', graceful);
    process.on('SIGTERM', graceful);
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
}

// Bootstrap
(async () => {
  await startServer();
})();
