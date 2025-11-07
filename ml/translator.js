const translate = require('translate-google');
const langDetect = require('./langDetect');

class Translator {
  constructor() {
    this.cache = new Map();
    this.targetLanguage = 'ru'; // Основной язык для сопоставления
  }

  async translate(text, targetLang = this.targetLanguage) {
    try {
      if (!text || text.trim().length === 0) {
        return text;
      }

      // Проверяем кэш
      const cacheKey = `${text}_${targetLang}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Определяем исходный язык
      const detection = langDetect.detect(text);
      const sourceLang = detection.language;

      // Если язык уже целевой или неизвестен - возвращаем оригинал
      if (sourceLang === targetLang || sourceLang === 'unknown') {
        this.cache.set(cacheKey, text);
        return text;
      }

      // Перевод
      const result = await translate(text, { 
        from: sourceLang, 
        to: targetLang 
      });

      this.cache.set(cacheKey, result);
      return result;

    } catch (error) {
      console.error('Translation error:', error);
      return text; // Возвращаем оригинал в случае ошибки
    }
  }

  async translateWish(wishData) {
    const { text, metadata = {} } = wishData;

    const translatedText = await this.translate(text);
    
    return {
      ...wishData,
      text: translatedText,
      metadata: {
        ...metadata,
        originalText: text,
        originalLanguage: langDetect.detect(text).language,
        translatedAt: new Date().toISOString()
      }
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new Translator();