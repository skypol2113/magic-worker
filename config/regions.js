module.exports = {
    regions: {
      europe: {
        name: 'Europe West',
        code: 'eu-west',
        languages: ['ru', 'en', 'es', 'fr', 'de'],
        timezone: 'Europe/London',
        dataCenter: 'europe-west1',
        legal: ['GDPR'],
        features: ['high-privacy']
      },
      asia: {
        name: 'Asia Central', 
        code: 'asia-central',
        languages: ['ru', 'kk', 'zh', 'en', 'tr'],
        timezone: 'Asia/Almaty',
        dataCenter: 'asia-northeast1',
        legal: ['PДнКЗ'], // Персональные данные Казахстан
        features: ['multilingual-support']
      },
      america: {
        name: 'US Central',
        code: 'us-central',
        languages: ['en', 'es'],
        timezone: 'America/Chicago',
        dataCenter: 'us-central1',
        legal: ['HIPAA', 'CCPA'],
        features: ['high-throughput']
      }
    },
  
    getRegionConfig(regionCode) {
      return this.regions[regionCode] || this.regions.europe;
    },
  
    getPreferredLanguages(regionCode) {
      const region = this.getRegionConfig(regionCode);
      return region.languages;
    },
  
    isLanguageSupported(regionCode, language) {
      const languages = this.getPreferredLanguages(regionCode);
      return languages.includes(language);
    }
  };