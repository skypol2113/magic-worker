// Тест полной обработки грузинского интента
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const SERVER_URL = 'http://45.136.57.119:3000';

async function testGeorgianIntent() {
  console.log("🧪 Testing full Georgian intent processing...\n");

  try {
    // 1. Создаем грузинский интент
    const testIntent = {
      text: "მე მინდა ვიყიდო ავტომობილი",
      userId: "test-user-" + Date.now(),
      userName: "Test User",
      category: "automotive",
      language: "ka"
    };

    console.log("📝 Creating Georgian intent:", testIntent.text);
    const response = await axios.post(`${SERVER_URL}/api/wishes`, testIntent);
    console.log("✅ Intent created with ID:", response.data.wishId);

    // 2. Ждем обработки
    console.log("⏳ Waiting for processing...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Получаем обновленный интент из коллекции wishes
    console.log("📊 Fetching processed intent from wishes collection...");
    const wishId = response.data.wishId;
    const updatedResponse = await axios.get(`${SERVER_URL}/api/wishes/${wishId}`);
    const intent = updatedResponse.data.wish;

    console.log("\n📋 Intent processing results:");
    console.log("   ID:", intent.id);
    console.log("   Original text:", intent.text);
    console.log("   Source language:", intent.sourceLang || "NOT DETECTED");
    console.log("   Worker version:", intent.workerVersion || "NOT SET");
    console.log("   Last processed:", intent.workerLastRun || "NEVER");
    console.log("   Worker processed:", intent.workerProcessed || false);
    
    if (intent.normalized) {
      console.log("   Normalized text:", intent.normalized.text || "NOT NORMALIZED");
      console.log("   Detection confidence:", intent.normalized.confidence || "N/A");
      console.log("   Failed:", intent.normalized.failed || false);
    } else {
      console.log("   Normalized: NOT CREATED");
    }

    // 4. Проверяем успешность
    if (intent.sourceLang === 'ka' && intent.normalized && intent.normalized.text && !intent.normalized.failed) {
      console.log("\n🎉 SUCCESS: Georgian intent processed successfully!");
    } else {
      console.log("\n❌ FAILED: Georgian intent processing incomplete");
      console.log("   Expected sourceLang: 'ka', got:", intent.sourceLang);
      console.log("   Expected normalized text, got:", intent.normalized?.text || "none");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("   Response:", error.response.data);
    }
  }
}

testGeorgianIntent();