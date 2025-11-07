const regions = require('../config/regions');
const logger = require('../utils/logger');

class GlobalOrchestrator {
  constructor() {
    this.regionalWorkers = new Map();
  }

  async routeWishToOptimalRegion(wishData) {
    const userRegion = this.detectUserRegion(wishData);
    const wishAnalysis = await this.analyzeWishForRouting(wishData);
    
    const optimalRegion = this.findOptimalRegion(userRegion, wishAnalysis);
    
    return {
      targetRegion: optimalRegion,
      routingReason: this.generateRoutingReason(userRegion, optimalRegion, wishAnalysis),
      crossRegionCompatibility: await this.checkCrossRegionCompatibility(wishData, optimalRegion)
    };
  }

  detectUserRegion(wishData) {
    // По IP, языку браузера, настройкам аккаунта
    const ipRegion = this.geoipLookup(wishData.ip);
    const languageRegion = this.mapLanguageToRegion(wishData.language);
    
    return ipRegion || languageRegion || 'europe';
  }

  async analyzeWishForRouting(wishData) {
    const semantic = require('../ml/semantic');
    
    return {
      languageComplexity: this.analyzeLanguageComplexity(wishData.text),
      culturalContext: this.analyzeCulturalContext(wishData.text),
      matchingPotential: await this.estimateMatchingPotential(wishData),
      regionalRelevance: this.analyzeRegionalRelevance(wishData.text)
    };
  }

  findOptimalRegion(userRegion, wishAnalysis) {
    const regionConfig = regions.getRegionConfig(userRegion);
    
    // Если желание имеет сильный региональный контекст
    if (wishAnalysis.regionalRelevance > 0.8) {
      return userRegion;
    }
    
    // Для многоязычных или международных желаний
    if (wishAnalysis.languageComplexity > 0.7) {
      return this.findBestMultilingualRegion(userRegion);
    }
    
    return userRegion;
  }

  async checkCrossRegionCompatibility(wishData, targetRegion) {
    // Проверяем, насколько хорошо желание будет понято в целевом регионе
    const translator = require('../ml/translator');
    const targetLanguages = regions.getPreferredLanguages(targetRegion);
    
    const compatibilityScores = await Promise.all(
      targetLanguages.map(async language => {
        const translated = await translator.translate(wishData.text, language);
        const similarity = await this.calculateTranslationQuality(wishData.text, translated);
        return { language, score: similarity };
      })
    );
    
    return compatibilityScores.sort((a, b) => b.score - a.score)[0];
  }

  generateRoutingReason(userRegion, targetRegion, analysis) {
    if (userRegion === targetRegion) {
      return 'оптимальный регион пользователя';
    }
    
    const reasons = [];
    
    if (analysis.culturalContext > 0.7) {
      reasons.push('культурный контекст');
    }
    
    if (analysis.matchingPotential > 0.8) {
      reasons.push('высокий потенциал совпадений');
    }
    
    return `маршрутизация в ${targetRegion} для ${reasons.join(', ')}`;
  }
}

module.exports = new GlobalOrchestrator();