// Тест обработки разных языков
const axios = require('axios');

const SERVER_URL = 'http://45.136.57.119:3000';

const testLanguages = [
  { text: "გამარჯობა, რა გინდა?", lang: "ka", name: "Georgian" },
  { text: "مرحبا، كيف حالك؟", lang: "ar", name: "Arabic" },
  { text: "こんにちは、元気ですか？", lang: "ja", name: "Japanese" },
  { text: "안녕하세요, 잘 지내세요?", lang: "ko", name: "Korean" },
  { text: "Xin chào, bạn khỏe không?", lang: "vi", name: "Vietnamese" },
  { text: "สวัสดี คุณสบายดีไหม?", lang: "th", name: "Thai" },
  { text: "Merhaba, nasılsın?", lang: "tr", name: "Turkish" },
  { text: "Hei, hvordan har du det?", lang: "no", name: "Norwegian" },
  { text: "Გამარჯობა, მე მინდა დავეხმარო ადამიანებს", lang: "ka", name: "Georgian (longer)" },
  { text: "שלום, מה שלומך?", lang: "he", name: "Hebrew" }
];

async function testLanguage(testCase) {
  try {
    const wish = {
      text: testCase.text,
      userId: `test-${testCase.lang}-${Date.now()}`,
      userName: `Test ${testCase.name}`,
      category: "test",
      language: testCase.lang
    };

    // Создаем интент
    const createRes = await axios.post(`${SERVER_URL}/api/wishes`, wish);
    const wishId = createRes.data.wishId;

    // Ждем обработки
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Получаем результат
    const getRes = await axios.get(`${SERVER_URL}/api/wishes/${wishId}`);
    const processed = getRes.data.wish;

    const success = 
      processed.sourceLang === testCase.lang &&
      processed.workerProcessed === true &&
      processed.normalized?.text &&
      !processed.normalized?.failed;

    console.log(`\n${success ? '✅' : '❌'} ${testCase.name} (${testCase.lang})`);
    console.log(`   Original: ${testCase.text}`);
    console.log(`   Detected: ${processed.sourceLang || 'NOT DETECTED'}`);
    console.log(`   Translated: ${processed.normalized?.text || 'FAILED'}`);
    console.log(`   Failed: ${processed.normalized?.failed || false}`);
    console.log(`   Worker: ${processed.workerVersion || 'NOT SET'}`);

    return { lang: testCase.name, success, processed };

  } catch (error) {
    console.log(`\n❌ ${testCase.name} (${testCase.lang}) - ERROR`);
    console.log(`   Error: ${error.message}`);
    return { lang: testCase.name, success: false, error: error.message };
  }
}

async function runTests() {
  console.log("🧪 Testing multiple language processing with retry logic...\n");
  console.log("=" .repeat(70));

  const results = [];
  
  for (const testCase of testLanguages) {
    const result = await testLanguage(testCase);
    results.push(result);
  }

  console.log("\n" + "=".repeat(70));
  console.log("\n📊 SUMMARY:");
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Success: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   Success Rate: ${((successful/results.length)*100).toFixed(1)}%`);

  if (failed > 0) {
    console.log("\n❌ Failed languages:");
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.lang}`);
    });
  }
}

runTests().catch(console.error);
