const express = require('express');
const { COLLECTIONS } = require('../config/firebase');
const router = express.Router();

// Используем глобальный db из index.js
const getDb = () => global.firestore || require('../config/firebase').db;

// Эндпоинт для Flutter приложения - создание желания
router.post('/wishes', async (req, res) => {
  try {
    const { text, userId, userName, location, category, language } = req.body;

    const wishData = {
      text,
      userId,
      userName: userName || 'Anonymous',
      location: location || {},
      category: category || 'general',
      language: language || 'auto',
      appId: 'com.magicai.box',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const wishRef = await getDb().collection(COLLECTIONS.WISHES).add(wishData);
    
    res.json({
      success: true,
      wishId: wishRef.id,
      message: 'Magic wish sent for processing! ✨',
      app: 'com.magicai.box'
    });

  } catch (error) {
    console.error('Error creating wish:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      app: 'com.magicai.box'
    });
  }
});

// Получение совпадений для пользователя
router.get('/users/:userId/matches', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const matchesSnapshot = await getDb().collection(COLLECTIONS.MATCHES)
      .where('userId', '==', userId)
      .where('appId', '==', 'com.magicai.box')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const matches = matchesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ 
      success: true, 
      matches,
      app: 'com.magicai.box'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      app: 'com.magicai.box'
    });
  }
});

// Статус обработки желания
router.get('/wishes/:wishId/status', async (req, res) => {
  const { wishId } = req.params;
  
  try {
    const wishDoc = await getDb().collection(COLLECTIONS.WISHES).doc(wishId).get();
    
    if (!wishDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wish not found',
        app: 'com.magicai.box'
      });
    }

    const wishData = wishDoc.data();
    
    res.json({
      success: true,
      status: wishData.status,
      matchesCount: wishData.matchesCount || 0,
      processedAt: wishData.processedAt,
      app: 'com.magicai.box'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      app: 'com.magicai.box'
    });
  }
});

// Получение желания по ID для тестирования
router.get('/wishes/:wishId', async (req, res) => {
  try {
    const { wishId } = req.params;
    
    const wishDoc = await getDb().collection(COLLECTIONS.WISHES).doc(wishId).get();
    
    if (!wishDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wish not found',
        app: 'com.magicai.box'
      });
    }

    const wishData = { id: wishDoc.id, ...wishDoc.data() };
    
    res.json({
      success: true,
      wish: wishData,
      app: 'com.magicai.box'
    });

  } catch (error) {
    console.error('Error fetching wish:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      app: 'com.magicai.box'
    });
  }
});

module.exports = router;