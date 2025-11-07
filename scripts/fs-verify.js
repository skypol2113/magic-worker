// scripts/fs-verify.js
'use strict';
const admin = require('firebase-admin');
const crypto = require('crypto');

function arg(name, def=null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i+1 < process.argv.length) return process.argv[i+1];
  return def;
}
const lang  = arg('lang', 'ru');
const base  = arg('base', '').trim();
const uid   = arg('uid',  '');
const token = arg('token', null);

if (!base) {
  console.error('{"error":"base is required"}');
  process.exit(2);
}

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

(async () => {
  try {
    // ADC: GOOGLE_APPLICATION_CREDENTIALS & GOOGLE_CLOUD_PROJECT
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    const db = admin.firestore();

    const baseKey  = sha1(`${lang}|${base}`);
    const tokenKey = token ? sha1(`${lang}|${base}|${token}`) : null;

    const stBaseRef  = db.doc(`assist_stats/${baseKey}`);
    const stBaseSnap = await stBaseRef.get();

    let stTokSnap = null;
    if (tokenKey) {
      const stTokRef = db.doc(`assist_stats/${tokenKey}`);
      stTokSnap = await stTokRef.get();
    }

    // feedback collection path
    const day = new Date().toISOString().slice(0,10);
    const anonId = `anon:${sha1(`${lang}|${base}`)}`;
    const owner  = uid ? uid : anonId;
    const fbCol  = db.collection(`assist_feedback/${owner}/${day}`);
    const fbSnap = await fbCol.limit(10).get();

    const out = {
      assist_stats_base: {
        id: baseKey,
        exists: stBaseSnap.exists,
        data: stBaseSnap.exists ? stBaseSnap.data() : null,
      },
      assist_stats_token: tokenKey ? {
        id: tokenKey,
        exists: stTokSnap?.exists || false,
        data: (stTokSnap && stTokSnap.exists) ? stTokSnap.data() : null,
      } : null,
      assist_feedback: {
        owner,
        day,
        count: fbSnap.size,
        sampleIds: fbSnap.docs.map(d => d.id),
      }
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ error: String(e && e.message || e) }));
    process.exit(1);
  }
})();
