const semantic = require('../ml/semantic');
const classifier = require('../ml/classifier');
const translator = require('../ml/translator');
const slangMap = require('../ml/slangMap');

class WishMatcher {
  constructor() {
    this.minSimilarityThreshold = 0.7;
  }

  async processWish(wishData) {
    try {
      // Шаг 1: Перевод и нормализация
      const translatedWish = await translator.translateWish(wishData);
      
      // Шаг 2: Классификация
      const classification = await classifier.classify(translatedWish.text);
      
      // Шаг 3: Поиск совпадений в базе
      const matches = await this.findMatches(translatedWish, classification);
      
      // Шаг 4: Формирование результата
      return {
        wishId: wishData.id,
        processedText: translatedWish.text,
        classification: classification,
        matches: matches,
        timestamp: new Date().toISOString(),
        metadata: translatedWish.metadata
      };

    } catch (error) {
      console.error('Error processing wish:', error);
      throw error;
    }
  }

  async findMatches(wishData, classification) {
    // Здесь должна быть логика поиска в базе данных
    // Пока заглушка с mock данными
    const mockCandidates = [
      { id: 1, text: "Хочу новый телефон", category: "material" },
      { id: 2, text: "Мечтаю о путешествии", category: "experience" },
      { id: 3, text: "Хочу научиться программировать", category: "skill" }
    ];

    const semanticMatches = await semantic.findBestMatches(
      wishData.text,
      mockCandidates,
      this.minSimilarityThreshold
    );

    return semanticMatches.map(match => ({
      candidateId: match.candidate.id,
      similarity: match.similarity,
      score: match.score,
      matchedText: match.candidate.text,
      reason: this.generateMatchReason(match, classification)
    }));
  }

  generateMatchReason(match, classification) {
    const reasons = [];
    
    if (match.similarity > 0.8) {
      reasons.push("высокая смысловая близость");
    }
    
    if (classification.wishType === match.candidate.category) {
      reasons.push("совпадение категорий");
    }
    
    if (classification.sentiment === 'positive') {
      reasons.push("позитивный тон");
    }

    return reasons.length > 0 ? reasons.join(", ") : "общее сходство";
  }
}

module.exports = new WishMatcher();