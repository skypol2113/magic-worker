// Создаем simple-server.js

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Простая имитация базы данных в памяти
const memoryDB = {
  wishes: [],
  matches: [],
  users: []
};

// Простой воркер в памяти
class SimpleWorker {
  constructor() {
    console.log('🔮 Simple Magic Box Worker initialized (no external dependencies)');
  }

  async processWish(wishData) {
    console.log('🔮 Processing wish:', {
      wishId: wishData.id,
      text: wishData.text?.substring(0, 50) + '...',
      app: wishData.appId
    });

    // Имитация обработки AI
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Генерация "магических" совпадений
    const magicMatches = this.generateMagicMatches(wishData.text);
    
    const result = {
      wishId: wishData.id,
      originalText: wishData.text,
      processedText: wishData.text + ' ✨', // Добавляем магию :)
      matches: magicMatches,
      analysis: {
        sentiment: this.analyzeSentiment(wishData.text),
        language: this.detectLanguage(wishData.text),
        magicScore: Math.random() * 0.5 + 0.5, // 0.5-1.0
        intent: this.detectIntent(wishData.text)
      },
      timestamp: new Date().toISOString(),
      metadata: {
        app: 'com.magicai.box',
        processingTime: '1.5s',
        status: 'magic_complete',
        worker: 'simple_magic_worker'
      }
    };

    // Сохраняем в память
    memoryDB.wishes.push({
      id: wishData.id,
      ...wishData,
      status: 'processed',
      processedAt: new Date()
    });

    memoryDB.matches.push(...magicMatches.map(match => ({
      ...match,
      wishId: wishData.id,
      createdAt: new Date()
    })));

    console.log('✅ Magic processing completed!', {
      wishId: wishData.id,
      matches: magicMatches.length,
      magicScore: result.analysis.magicScore
    });

    return result;
  }

  generateMagicMatches(text) {
    const magicThemes = ['crystals', 'spells', 'potions', 'wands', 'tarot', 'astrology', 'meditation'];
    const matches = [];

    // Создаем 1-3 магических совпадения
    const matchCount = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < matchCount; i++) {
      const theme = magicThemes[Math.floor(Math.random() * magicThemes.length)];
      matches.push({
        candidateId: `magic_match_${Date.now()}_${i}`,
        similarity: Math.random() * 0.3 + 0.7, // 0.7-1.0
        score: Math.random() * 0.2 + 0.8, // 0.8-1.0
        matchedText: `I also love ${theme} and ${text.toLowerCase().split(' ').slice(0, 3).join(' ')}...`,
        reason: `magical ${theme} connection`,
        confidence: Math.random() * 0.2 + 0.8,
        magicType: theme
      });
    }

    return matches;
  }

  analyzeSentiment(text) {
    const positiveWords = ['love', 'want', 'like', 'amazing', 'beautiful', 'happy', 'excited'];
    const negativeWords = ['hate', 'bad', 'terrible', 'sad', 'angry'];
    
    const words = text.toLowerCase().split(' ');
    let score = 0;
    
    words.forEach(word => {
      if (positiveWords.includes(word)) score += 1;
      if (negativeWords.includes(word)) score -= 1;
    });

    return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  }

  detectLanguage(text) {
    // Простой детектор языка
    if (text.match(/[а-яё]/i)) return 'russian';
    if (text.match(/[a-z]/i)) return 'english'; 
    return 'unknown';
  }

  detectIntent(text) {
    text = text.toLowerCase();
    if (text.includes('learn') || text.includes('study')) return 'learning';
    if (text.includes('buy') || text.includes('get')) return 'acquisition';
    if (text.includes('find') || text.includes('meet')) return 'discovery';
    if (text.includes('help') || text.includes('support')) return 'assistance';
    return 'expression';
  }

  getStats() {
    return {
      wishes: memoryDB.wishes.length,
      matches: memoryDB.matches.length,
      users: memoryDB.users.length,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

const worker = new SimpleWorker();

// Маршруты API
app.get('/', (req, res) => {
  res.json({
    message: '🔮 Magic Box Simple Server is running! ✨',
    app: 'com.magicai.box',
    mode: 'standalone (no Redis, no Docker)',
    endpoints: {
      'GET /': 'this info',
      'POST /api/wish': 'create magic wish',
      'GET /api/stats': 'get statistics',
      'GET /api/wishes': 'list all wishes',
      'GET /api/matches': 'list all matches'
    },
    timestamp: new Date().toISOString()
  });
});

// Создание магического желания
app.post('/api/wish', async (req, res) => {
  try {
    const { text, userId = 'user_' + Date.now(), userName = 'Magic User' } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Text is required for magic wishes!'
      });
    }

    const wishData = {
      id: `wish_${Date.now()}`,
      text: text,
      userId: userId,
      userName: userName,
      appId: 'com.magicai.box',
      source: 'direct_api',
      createdAt: new Date()
    };

    const result = await worker.processWish(wishData);
    
    res.json({
      success: true,
      message: '✨ Your magic wish has been processed!',
      data: result,
      metadata: {
        app: 'com.magicai.box',
        magic: true,
        server: 'simple_magic_server'
      }
    });
  } catch (error) {
    console.error('Error processing magic wish:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      magic: false
    });
  }
});

// Статистика
app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    stats: worker.getStats(),
    system: {
      node: process.version,
      platform: process.platform,
      uptime: process.uptime()
    }
  });
});

// Список всех желаний
app.get('/api/wishes', (req, res) => {
  res.json({
    success: true,
    wishes: memoryDB.wishes,
    count: memoryDB.wishes.length
  });
});

// Список всех совпадений
app.get('/api/matches', (req, res) => {
  res.json({
    success: true,
    matches: memoryDB.matches,
    count: memoryDB.matches.length
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    magic: 'working',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('🎉 =================================');
  console.log('🔮 MAGIC BOX SERVER STARTED!');
  console.log(`📍 http://localhost:${PORT}`);
  console.log('✨ No Docker, No Redis, Pure Magic!');
  console.log('🎉 =================================');
  
  console.log(`
  🎩 Welcome to Magic Box! 🎩
  
  Your server is running at: http://localhost:${PORT}
  
  Try these commands in PowerShell:
  
  1. Check server status:
     Invoke-RestMethod "http://localhost:${PORT}/"
  
  2. Send a magic wish:
     $body = '{"text": "I want to learn magic tricks"}'
     Invoke-RestMethod "http://localhost:${PORT}/api/wish" -Method Post -Body $body -ContentType "application/json"
  
  3. View statistics:
     Invoke-RestMethod "http://localhost:${PORT}/api/stats"
  `);
});