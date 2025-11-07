// worker/translators/googleTranslate.js
const { Translate } = require('@google-cloud/translate').v2;


const translateClient = new Translate({
// projectId берётся из ADC/ENV; можно явно: projectId: process.env.GOOGLE_CLOUD_PROJECT
});


async function detectLanguage(text) {
const [detection] = await translateClient.detect(text);
// detection может быть массивом; нормализуем
const info = Array.isArray(detection) ? detection[0] : detection;
return (info && info.language) || 'und';
}


async function translateToEn(text, sourceLang) {
const target = 'en';
const opts = sourceLang && sourceLang !== 'auto' ? { from: sourceLang } : {};
const t0 = Date.now();
const [translation] = await translateClient.translate(text, { ...opts, to: target });
const ms = Date.now() - t0;
return { text: translation, provider: 'gct', ms };
}


module.exports = { detectLanguage, translateToEn };