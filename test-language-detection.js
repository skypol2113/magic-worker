// Тест детекции грузинского языка
const http = require('http');

const testCases = [
  { text: "გამარჯობა, როგორ ხარ?", expected: "ka", description: "Грузинский: Привет, как дела?" },
  { text: "Hello, how are you?", expected: "en", description: "Английский" },
  { text: "Привет, как дела?", expected: "ru", description: "Русский" },
  { text: "მე მინდა ვიყიდო ავტომობილი", expected: "ka", description: "Грузинский: Я хочу купить машину" }
];

async function testLanguageDetection() {
  console.log("🧪 Testing language detection...\n");
  
  for (const testCase of testCases) {
    try {
      const postData = JSON.stringify({ text: testCase.text });
      
      const options = {
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/detect',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const result = await new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
      
      const detected = result.lang || 'unknown';
      const status = detected === testCase.expected ? "✅" : "❌";
      
      console.log(`${status} ${testCase.description}`);
      console.log(`   Text: "${testCase.text}"`);
      console.log(`   Expected: ${testCase.expected}, Got: ${detected}\n`);
      
    } catch (error) {
      console.log(`❌ Error testing: ${testCase.description}`);
      console.log(`   Error: ${error.message}\n`);
    }
  }
}

testLanguageDetection().catch(console.error);