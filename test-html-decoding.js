// Тест декодирования HTML entities в переводах
const axios = require('axios');

const SERVER_URL = 'http://45.136.57.119:3000';

const testCases = [
  {
    name: "Apostrophe Test",
    text: "I'm happy to help you!",  // English with apostrophe
    expected: "I'm",  // Should NOT be I&#39;m
    lang: "en"
  },
  {
    name: "Quotes Test",
    text: 'He said "Hello" to me',  // English with quotes
    expected: '"Hello"',  // Should NOT be &quot;Hello&quot;
    lang: "en"
  },
  {
    name: "Russian with quotes",
    text: 'Он сказал "Привет"',  // Russian with quotes
    expected: '"',  // Should contain actual quote
    lang: "ru"
  },
  {
    name: "Georgian with apostrophe context",
    text: "მე ვარ კარგად, გმადლობთ!",  // Georgian
    shouldNotContain: "&#",  // Should NOT contain HTML entities
    lang: "ka"
  }
];

async function testHtmlDecoding() {
  console.log("🧪 Testing HTML entity decoding in translations...\n");
  console.log("=".repeat(70));

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    try {
      // Create wish
      const wish = {
        text: testCase.text,
        userId: `test-html-${Date.now()}`,
        userName: "HTML Test",
        category: "test",
        language: testCase.lang
      };

      const createRes = await axios.post(`${SERVER_URL}/api/wishes`, wish);
      const wishId = createRes.data.wishId;

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Get result
      const getRes = await axios.get(`${SERVER_URL}/api/wishes/${wishId}`);
      const processed = getRes.data.wish;

      const originalText = processed.text;
      const translatedText = processed.normalized?.text || '';

      // Check for HTML entities
      const hasHtmlEntities = /&#\d+;|&\w+;/.test(translatedText);
      
      let testPassed = true;
      let errorMsg = '';

      if (hasHtmlEntities) {
        testPassed = false;
        errorMsg = `Contains HTML entities: ${translatedText.match(/&#\d+;|&\w+;/g)}`;
      } else if (testCase.expected && !translatedText.includes(testCase.expected)) {
        testPassed = false;
        errorMsg = `Missing expected substring: "${testCase.expected}"`;
      } else if (testCase.shouldNotContain && translatedText.includes(testCase.shouldNotContain)) {
        testPassed = false;
        errorMsg = `Contains forbidden substring: "${testCase.shouldNotContain}"`;
      }

      if (testPassed) {
        console.log(`\n✅ ${testCase.name}`);
        console.log(`   Original: ${originalText}`);
        console.log(`   Translated: ${translatedText}`);
        console.log(`   No HTML entities found ✓`);
        passed++;
      } else {
        console.log(`\n❌ ${testCase.name}`);
        console.log(`   Original: ${originalText}`);
        console.log(`   Translated: ${translatedText}`);
        console.log(`   ERROR: ${errorMsg}`);
        failed++;
      }

    } catch (error) {
      console.log(`\n❌ ${testCase.name} - ERROR`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`\n📊 Results: ${passed}/${testCases.length} passed`);
  
  if (failed === 0) {
    console.log("🎉 All tests passed! HTML entities are properly decoded.");
  } else {
    console.log(`❌ ${failed} test(s) failed. HTML entity decoding needs fixing.`);
  }
}

testHtmlDecoding().catch(console.error);
