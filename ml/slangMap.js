class SlangMapper {
    constructor() {
      this.slangDictionary = {
        // Русский сленг
        'рубать': 'понимать',
        'краш': 'влюбленность',
        'хайп': 'шум',
        'рофл': 'шутка',
        'кринж': 'стыд',
        'имба': 'превосходно',
        'говно': 'плохо',
        'офигенно': 'отлично',
        'клево': 'хорошо',
        'прикольно': 'интересно',
        
        // Английский сленг
        'lit': 'круто',
        'sick': 'больной',
        'dope': 'круто',
        'ghost': 'исчезнуть',
        'salty': 'раздраженный',
        'thirsty': 'отчаянный',
        'woke': 'осознанный',
        
        // Эмоции и интенты
        'хочу': 'желаю',
        'мечтаю': 'хочу',
        'желаю': 'хочу',
        'нужно': 'требуется',
        'необходимо': 'нужно'
      };
  
      this.intentPatterns = {
        purchase: [/купить|приобрести|купиться/i],
        experience: [/посетить|увидеть|попробовать/i],
        learning: [/научиться|изучить|освоить/i],
        travel: [/поехать|посетить|путешествовать/i],
        entertainment: [/посмотреть|сыграть|развлечься/i]
      };
    }
  
    normalizeText(text) {
      if (!text) return '';
  
      let normalized = text.toLowerCase();
      
      // Замена сленга
      Object.keys(this.slangDictionary).forEach(slang => {
        const regex = new RegExp(`\\b${slang}\\b`, 'gi');
        normalized = normalized.replace(regex, this.slangDictionary[slang]);
      });
  
      // Удаление лишних символов
      normalized = normalized.replace(/[^\w\sа-яА-ЯёЁ]/gi, ' ');
      normalized = normalized.replace(/\s+/g, ' ').trim();
  
      return normalized;
    }
  
    detectIntent(text) {
      const normalized = this.normalizeText(text);
      
      for (const [intent, patterns] of Object.entries(this.intentPatterns)) {
        for (const pattern of patterns) {
          if (pattern.test(normalized)) {
            return intent;
          }
        }
      }
  
      return 'general';
    }
  
    extractKeywords(text) {
      const normalized = this.normalizeText(text);
      const words = normalized.split(' ');
      
      // Фильтруем стоп-слова
      const stopWords = new Set(['хочу', 'желаю', 'мечтаю', 'нужно', 'хотелось']);
      const keywords = words.filter(word => 
        word.length > 2 && !stopWords.has(word)
      );
  
      return [...new Set(keywords)]; // Убираем дубликаты
    }
  }
  
  module.exports = new SlangMapper();