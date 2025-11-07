// worker/translators/googleTranslate.js
// Cloud Translation API v3 через ADC (service account). Без API-ключей.
// Документация: https://cloud.google.com/translate/docs/advanced/translate-advanced

'use strict';

const { TranslationServiceClient } = require('@google-cloud/translate').v3;

// --- Проект/локация ---
// Для v3 parent = projects/{project}/locations/{location}
// Практично использовать 'global' для detect/translate.
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT ||
  process.env.project_id || // на случай, если переменная названа так
  '';

const location = process.env.TRANSLATE_LOCATION || process.env.VERTEX_LOCATION || 'global';

// Клиент поднимется по ADC (GOOGLE_APPLICATION_CREDENTIALS указывает на JSON ключ сервис-аккаунта).
const client = new TranslationServiceClient();

function parentPath() {
  if (!projectId) {
    throw new Error('GCT v3: переменная окружения GOOGLE_CLOUD_PROJECT (или FIREBASE_PROJECT_ID) не задана.');
  }
  return `projects/${projectId}/locations/${location}`;
}

/**
 * Определение языка текста.
 * @param {string} text
 * @returns {Promise<string>} ISO-код, например 'ru', 'en', либо 'und'
 */
async function detectLanguage(text) {
  const content = (text || '').toString();
  if (!content.trim()) return 'und';

  try {
    const [resp] = await client.detectLanguage({
      parent: parentPath(),
      content,
      // mimeType: 'text/plain', // по умолчанию
    });
    // Берём самый уверенный вариант
    const lang = resp?.languages?.[0]?.languageCode || 'und';
    return lang;
  } catch (e) {
    console.warn('GCT v3 detectLanguage warn:', e.message || e);
    return 'und';
  }
}

/**
 * Перевод текста в EN (удобный шорткат).
 * @param {string} text
 * @param {string} from 'auto' | 'ru' | ...
 * @returns {Promise<{text:string, provider:string, ms:number, fallback?:boolean}>}
 */
async function translateToEn(text, from = 'auto') {
  return translate(text, 'en', from);
}

/**
 * Универсальный перевод на любой язык (ISO code), c optional source lang.
 * @param {string} text
 * @param {string} targetLang например 'en', 'ru', 'ar'
 * @param {string} from 'auto' | 'ru' | ...
 * @returns {Promise<{text:string, provider:string, ms:number, fallback?:boolean}>}
 */
async function translate(text, targetLang, from = 'auto') {
  const started = Date.now();

  const content = (text || '').toString();
  const target = (targetLang || '').toString().trim().toLowerCase();

  if (!content.trim()) return { text: '', provider: 'gct', ms: 0 };
  if (!target)        return { text: content, provider: 'gct', ms: 0 };

  // Если целевой язык совпадает с исходным — возвращаем «как есть».
  try {
    if (from && from !== 'auto' && from.toLowerCase() === target) {
      return { text: content, provider: 'gct', ms: 0 };
    }
  } catch (_) {}

  const request = {
    parent: parentPath(),
    contents: [content],
    targetLanguageCode: target,
    // mimeType: 'text/plain', // по умолчанию
  };

  if (from && from !== 'auto') {
    request.sourceLanguageCode = from;
  }

  try {
    const [resp] = await client.translateText(request);
    const out = resp?.translations?.[0]?.translatedText || content;
    return { text: out, provider: 'gct', ms: Date.now() - started };
  } catch (e) {
    // Тихий фолбэк на оригинальный текст, чтобы не ломать поток
    console.warn('GCT v3 translate warn:', e.message || e);
    return { text: content, provider: 'gct', ms: Date.now() - started, fallback: true };
  }
}

module.exports = {
  detectLanguage,
  translateToEn,
  translate,
};
