// worker/translators/index.js
'use strict';

const provider = (process.env.TRANSLATOR_PROVIDER || 'gct').toLowerCase();
const embeddingsEnabled = process.env.EMBEDDINGS_ENABLED === 'true';
const embeddingsProvider = (process.env.EMBEDDINGS_PROVIDER || 'vertex').toLowerCase();

console.log(`🔧 Translator: ${provider.toUpperCase()}`);
console.log(
  `🔧 Embeddings: ${embeddingsEnabled ? `${embeddingsProvider.toUpperCase()} (ENABLED)` : 'DISABLED'}`
);

// ---- Translator impl
const translatorImpl = provider === 'vertex'
  ? require('./vertex')
  : require('./googleTranslate');

// ---- Embeddings impl (optional)
const embeddingsImpl = embeddingsEnabled ? require('./embeddings') : null;

// ---- Base API (always available)
const api = {
  detectLanguage: translatorImpl.detectLanguage,
  translateToEn: translatorImpl.translateToEn,
  translate: translatorImpl.translate,
};

// ---- Universal translate()
// Prefer provider's translate if present; otherwise fallback to translateToEn (only for 'en')
api.translate = typeof translatorImpl.translate === 'function'
  ? translatorImpl.translate
  : async (text, to, from = 'auto') => {
      const target = (to || '').toString().trim().toLowerCase();
      if (!target) throw new Error('translate: target language required');
      if (target === 'en') {
        // reuse existing function shape: { text, provider, ms, fallback? }
        return translatorImpl.translateToEn(text, from);
      }
      // No generic translate in current provider
      return {
        text: (text || '').toString(),
        provider: provider,
        ms: 0,
        fallback: true,
        note: 'Generic translate() not supported by current provider; returned original text.',
      };
    };

// 🔥 НОВЫЕ ФУНКЦИИ ДЛЯ МНОГОЯЗЫЧНОСТИ
api.translateFromEn = async (text, targetLang) => {
  console.log(`🌐 Translating from EN to ${targetLang}: "${text.substring(0, 50)}..."`);
  
  // Если целевой язык английский - возвращаем как есть
  if (targetLang === 'en') {
    return text;
  }
  
  try {
    // Пробуем использовать общую функцию translate если она есть
    if (typeof api.translate === 'function') {
      const result = await api.translate(text, targetLang, 'en');
      return result.text || text;
    }
    
    // Фолбэк: используем прямой вызов GCT с указанием целевого языка
    // Для GCT v3 нам нужно использовать другой подход
    const { TranslationServiceClient } = require('@google-cloud/translate').v3;
    const client = new TranslationServiceClient();
    
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
    const location = process.env.TRANSLATE_LOCATION || 'global';
    
    const request = {
      parent: `projects/${projectId}/locations/${location}`,
      contents: [text],
      mimeType: 'text/plain',
      targetLanguageCode: targetLang,
    };
    
    const [response] = await client.translateText(request);
    return response.translations[0].translatedText;
    
  } catch (error) {
    console.warn(`❌ Translation EN->${targetLang} failed:`, error.message);
    
    // Ultimate fallback - пробуем через translateToEn с фиктивным исходным языком
    try {
      console.log(`🔄 Trying fallback translation...`);
      const result = await translatorImpl.translateToEn(text, 'auto');
      return result.text;
    } catch (fallbackError) {
      console.warn(`❌ Fallback translation also failed:`, fallbackError.message);
      return text; // Фолбэк на английский текст
    }
  }
};

// Вспомогательная функция - список поддерживаемых языков
api.getSupportedLanguages = () => {
  return ['en', 'ru', 'de', 'es', 'fr', 'zh', 'ja', 'ar', 'pt', 'it'];
};

// Проверка доступности переводчика
api.healthCheck = async () => {
  try {
    const testResult = await translatorImpl.translateToEn('hello', 'en');
    return {
      status: 'healthy',
      provider: provider,
      message: 'Translation service is working'
    };
  } catch (error) {
    return {
      status: 'unhealthy', 
      provider: provider,
      error: error.message
    };
  }
};

// ---- Embeddings (real or stubs)
if (embeddingsEnabled && embeddingsImpl) {
  api.getEmbedding = embeddingsImpl.getEmbedding;
  api.semanticSimilarity = embeddingsImpl.semanticSimilarity;
  api.classifyText = embeddingsImpl.classifyText;
  api.cosineSimilarity = embeddingsImpl.cosineSimilarity;
} else {
  api.getEmbedding = async () => {
    console.log('🔕 Embeddings disabled - returning empty vector');
    return [];
  };
  api.semanticSimilarity = async () => {
    console.log('🔕 Embeddings disabled - returning zero similarity');
    return 0;
  };
  api.classifyText = async (text) => {
    console.log('🔕 Embeddings disabled - returning general category');
    return 'general';
  };
  api.cosineSimilarity = () => 0;
  console.log('ℹ️  Embeddings disabled - using stub functions');
}

module.exports = api;