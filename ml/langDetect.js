const franc = require('franc');
const langs = require('langs');

class LanguageDetector {
  constructor() {
    this.supportedLanguages = ['rus', 'eng', 'spa', 'kaz']; // ru, en, es, kk
  }

  detect(text) {
    try {
      if (!text || text.length < 3) {
        return { language: 'unknown', confidence: 0 };
      }

      const result = franc.all(text, { minLength: 2 });
      
      if (result.length === 0) {
        return { language: 'unknown', confidence: 0 };
      }

      const topResult = result[0];
      const langCode = topResult[0];
      const confidence = topResult[1];

      // Конвертируем в ISO 639-1
      const language = this.mapToISO6391(langCode);

      return {
        language: this.supportedLanguages.includes(language) ? language : 'unknown',
        confidence: Math.round(confidence * 100) / 100,
        raw: langCode
      };
    } catch (error) {
      console.error('Language detection error:', error);
      return { language: 'unknown', confidence: 0 };
    }
  }

  mapToISO6391(francCode) {
    const mapping = {
      'rus': 'ru',
      'eng': 'en', 
      'spa': 'es',
      'kaz': 'kk',
      'ukr': 'uk',
      'deu': 'de',
      'fra': 'fr'
    };
    
    return mapping[francCode] || francCode;
  }

  isSupported(language) {
    return this.supportedLanguages.includes(language);
  }
}

module.exports = new LanguageDetector();