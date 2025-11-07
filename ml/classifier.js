const { NlpManager } = require('node-nlp');
const slangMap = require('./slangMap');
const langDetect = require('./langDetect');

class WishClassifier {
  constructor() {
    this.manager = new NlpManager({ languages: ['ru', 'en'] });
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Базовые интенты на русском
    this.manager.addNamedEntityText('object', 'phone', ['ru'], ['телефон', 'смартфон', 'айфон']);
    this.manager.addNamedEntityText('object', 'trip', ['ru'], ['путешествие', 'поездка', 'тур']);
    this.manager.addNamedEntityText('object', 'car', ['ru'], ['машина', 'автомобиль', 'тачка']);
    
    // Базовые интенты на английском
    this.manager.addNamedEntityText('object', 'phone', ['en'], ['phone', 'smartphone', 'iphone']);
    this.manager.addNamedEntityText('object', 'trip', ['en'], ['trip', 'travel', 'journey']);
    this.manager.addNamedEntityText('object', 'car', ['en'], ['car', 'auto', 'vehicle']);

    await this.manager.train();
    this.initialized = true;
  }

  async classify(wishText) {
    if (!this.initialized) {
      await this.initialize();
    }

    const language = langDetect.detect(wishText).language;
    const normalizedText = slangMap.normalizeText(wishText);
    
    const nlpResult = await this.manager.process(language, normalizedText);
    
    // Определяем эмоциональный тон
    const sentiment = this.analyzeSentiment(wishText);
    
    // Определяем тип желания
    const wishType = this.determineWishType(normalizedText);
    
    // Извлекаем сущности
    const entities = this.extractEntities(nlpResult);

    return {
      intent: nlpResult.intent,
      confidence: nlpResult.score,
      sentiment: sentiment,
      wishType: wishType,
      entities: entities,
      language: language,
      normalizedText: normalizedText,
      keywords: slangMap.extractKeywords(wishText)
    };
  }

  analyzeSentiment(text) {
    const positiveWords = ['хорошо', 'отлично', 'прекрасно', 'люблю', 'нравится', 'счастлив'];
    const negativeWords = ['плохо', 'ужасно', 'ненавижу', 'разочарован', 'грустно'];
    
    let score = 0;
    const words = text.toLowerCase().split(' ');
    
    words.forEach(word => {
      if (positiveWords.includes(word)) score += 1;
      if (negativeWords.includes(word)) score -= 1;
    });

    if (score > 0) return 'positive';
    if (score < 0) return 'negative';
    return 'neutral';
  }

  determineWishType(text) {
    const patterns = {
      material: [/телефон|машина|квартира|дом|одежда|техника/i],
      experience: [/путешествие|концерт|кино|ресторан|курс/i],
      skill: [/научиться|изучить|освоить|курс/i],
      relationship: [/друг|подруга|встретить|любовь/i],
      health: [/здоровье|похудеть|спорт/i]
    };

    for (const [type, regexes] of Object.entries(patterns)) {
      for (const regex of regexes) {
        if (regex.test(text)) {
          return type;
        }
      }
    }

    return 'other';
  }

  extractEntities(nlpResult) {
    const entities = {};
    
    nlpResult.entities.forEach(entity => {
      if (!entities[entity.entity]) {
        entities[entity.entity] = [];
      }
      entities[entity.entity].push(entity.utteranceText);
    });

    return entities;
  }
}

module.exports = new WishClassifier();