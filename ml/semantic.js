const tf = require('@tensorflow/tfjs-node');
const use = require('@tensorflow-models/universal-sentence-encoder');
const fastText = require('fasttext');
const path = require('path');

class EnhancedSemanticAnalyzer {
  constructor() {
    this.useModel = null;
    this.fastTextModel = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    console.log('Загружаем модели семантического анализа...');
    
    // Загружаем Universal Sentence Encoder
    this.useModel = await use.load();
    
    // Загружаем fastText для мультиязычного понимания
    try {
      this.fastTextModel = new fastText.classifier();
      await this.fastTextModel.loadModel(path.join(__dirname, 'models/lid.176.bin'));
    } catch (error) {
      console.warn('FastText model not available, using fallback');
    }

    this.initialized = true;
    console.log('Модели семантического анализа загружены');
  }

  async analyzeWish(wishText, context = {}) {
    const embedding = await this.getEmbedding(wishText);
    const language = await this.detectLanguageFast(wishText);
    const semanticScore = await this.calculateSemanticQuality(wishText);
    const intentStrength = await this.analyzeIntentStrength(wishText);

    return {
      embedding,
      language,
      semanticScore,
      intentStrength,
      contextRelevance: this.calculateContextRelevance(wishText, context),
      crossLingualCompatibility: await this.checkCrossLingualCompatibility(wishText)
    };
  }

  async detectLanguageFast(text) {
    if (this.fastTextModel && text.length > 3) {
      try {
        const prediction = await this.fastTextModel.predict(text, 3);
        return {
          primary: prediction[0].label.replace('__label__', ''),
          confidence: prediction[0].value,
          alternatives: prediction.slice(1).map(p => ({
            language: p.label.replace('__label__', ''),
            confidence: p.value
          }))
        };
      } catch (error) {
        // Fallback to franc
        return require('./langDetect').detect(text);
      }
    }
    return require('./langDetect').detect(text);
  }

  async calculateSemanticQuality(text) {
    // Анализ качества семантического содержания
    const factors = {
      specificity: this.analyzeSpecificity(text),
      clarity: this.analyzeClarity(text),
      completeness: this.analyzeCompleteness(text),
      emotionalDepth: this.analyzeEmotionalDepth(text)
    };

    const weights = {
      specificity: 0.3,
      clarity: 0.3,
      completeness: 0.2,
      emotionalDepth: 0.2
    };

    return Object.keys(factors).reduce((score, factor) => {
      return score + (factors[factor] * weights[factor]);
    }, 0);
  }

  analyzeSpecificity(text) {
    // Анализ конкретности желания
    const specificIndicators = [/цена|бюджет|место|время|цвет|размер/i];
    const vagueIndicators = [/что-то|какой-то|не знаю|может быть/i];
    
    let score = 0.5; // нейтральная база
    
    specificIndicators.forEach(indicator => {
      if (indicator.test(text)) score += 0.2;
    });
    
    vagueIndicators.forEach(indicator => {
      if (indicator.test(text)) score -= 0.2;
    });

    return Math.max(0, Math.min(1, score));
  }

  async analyzeIntentStrength(text) {
    // Анализ силы намерения
    const strongIntent = [/хочу|нужно|необходимо|требуется|ищу|надо/gi];
    const weakIntent = [/может быть|возможно|подумать|если/gi];
    
    let strength = 0.5;
    
    const strongMatches = text.match(strongIntent) || [];
    const weakMatches = text.match(weakIntent) || [];
    
    strength += (strongMatches.length * 0.1);
    strength -= (weakMatches.length * 0.1);
    
    return Math.max(0, Math.min(1, strength));
  }

  async findGlobalMatches(query, regionContext = {}) {
    const queryAnalysis = await this.analyzeWish(query, regionContext);
    
    // Мультиязычный поиск с учетом региона
    const matches = await this.searchCrossLingualMatches(query, queryAnalysis, regionContext);
    
    // Применяем региональные правила
    const regionalMatches = this.applyRegionalRules(matches, regionContext);
    
    return {
      queryAnalysis,
      matches: regionalMatches,
      matchReason: this.generateGlobalMatchReason(regionalMatches, regionContext),
      regionalCompatibility: this.calculateRegionalCompatibility(regionalMatches, regionContext)
    };
  }

  async searchCrossLingualMatches(query, queryAnalysis, regionContext) {
    // Поиск совпадений с учетом перевода и культурного контекста
    const translatedQuery = await require('./translator').translate(query, 'en');
    const candidates = await this.findCandidatesInRegion(regionContext);
    
    const semanticMatches = await this.findBestMatches(translatedQuery, candidates);
    
    // Дополнительный поиск на оригинальном языке
    const nativeMatches = await this.findBestMatches(query, candidates);
    
    return this.mergeMatches(semanticMatches, nativeMatches, queryAnalysis);
  }

  applyRegionalRules(matches, regionContext) {
    return matches.filter(match => {
      // Применяем GDPR и другие регуляторные требования
      if (regionContext.legal.includes('GDPR') && !match.consentGiven) {
        return false;
      }
      
      // Проверяем языковую совместимость
      if (!this.isLanguageCompatible(match.language, regionContext.preferredLanguages)) {
        return false;
      }
      
      return true;
    });
  }

  generateGlobalMatchReason(matches, regionContext) {
    const reasons = [];
    
    if (matches.length > 0) {
      const topMatch = matches[0];
      
      if (topMatch.semanticScore > 0.85) {
        reasons.push('высокая семантическая близость');
      }
      
      if (topMatch.crossLingual) {
        reasons.push('кросс-языковое совпадение');
      }
      
      if (topMatch.regionalBoost) {
        reasons.push('региональная релевантность');
      }
    }
    
    return reasons.length > 0 ? reasons.join(', ') : 'потенциальное совпадение';
  }
}

module.exports = new EnhancedSemanticAnalyzer();