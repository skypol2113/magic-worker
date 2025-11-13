// migrate-source-lang.js - Миграция для добавления sourceLang к существующим интентам

const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function migrateIntents() {
  console.log('🚀 Starting migration: adding sourceLang to existing intents...');
  
  let processed = 0;
  let updated = 0;
  let errors = 0;
  
  try {
    // Получаем интенты без sourceLang
    const snapshot = await db.collection('intents')
      .get();
    
    console.log(`📊 Found ${snapshot.size} intents to check`);
    
    const batch = db.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500;
    
    for (const doc of snapshot.docs) {
      processed++;
      const data = doc.data();
      
      // Пропускаем если sourceLang уже есть
      if (data.sourceLang) {
        continue;
      }
      
      try {
        const detectedLang = data.normalized?.detectedLang;
        
        if (detectedLang && detectedLang !== 'und') {
          batch.set(doc.ref, {
            sourceLang: detectedLang,
            workerVersion: 'magicbox-worker-2.0',
            migratedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          
          updated++;
          batchCount++;
          
          // Коммитим батч если достигли лимита
          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            console.log(`✅ Batch committed: ${updated} intents updated`);
            batchCount = 0;
          }
        } else {
          console.log(`⚠️ Intent ${doc.id}: no detectedLang found`);
        }
        
      } catch (e) {
        console.error(`❌ Error processing intent ${doc.id}:`, e.message);
        errors++;
      }
      
      // Лог прогресса каждые 100 интентов
      if (processed % 100 === 0) {
        console.log(`📈 Progress: ${processed}/${snapshot.size} processed, ${updated} updated, ${errors} errors`);
      }
    }
    
    // Коммитим оставшиеся
    if (batchCount > 0) {
      await batch.commit();
      console.log(`✅ Final batch committed`);
    }
    
    console.log(`🎉 Migration completed!`);
    console.log(`📊 Summary: ${processed} processed, ${updated} updated, ${errors} errors`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Запуск миграции
migrateIntents().catch(console.error);