class TelemetryCollector {
    constructor() {
      this.metrics = {
        wishesProcessed: 0,
        matchesFound: 0,
        crossRegionalMatches: 0,
        avgProcessingTime: 0,
        regionalDistribution: {},
        languageDistribution: {}
      };
    }
  
    recordWishProcessing(wishData, result) {
      this.metrics.wishesProcessed++;
      
      if (result.matches.length > 0) {
        this.metrics.matchesFound++;
      }
      
      if (result.crossRegional) {
        this.metrics.crossRegionalMatches++;
      }
      
      // Региональная статистика
      const region = wishData.region || 'unknown';
      this.metrics.regionalDistribution[region] = 
        (this.metrics.regionalDistribution[region] || 0) + 1;
      
      // Языковая статистика  
      const language = wishData.language || 'unknown';
      this.metrics.languageDistribution[language] =
        (this.metrics.languageDistribution[language] || 0) + 1;
    }
  
    getMetrics() {
      return {
        ...this.metrics,
        matchRate: this.metrics.wishesProcessed > 0 ? 
          (this.metrics.matchesFound / this.metrics.wishesProcessed) : 0,
        crossRegionalRate: this.metrics.matchesFound > 0 ?
          (this.metrics.crossRegionalMatches / this.metrics.matchesFound) : 0
      };
    }
  }
  
  module.exports = new TelemetryCollector();