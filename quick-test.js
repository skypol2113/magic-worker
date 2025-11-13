// Быстрый тест создания интента
const axios = require('axios');

async function quickTest() {
  const wish = {
    text: "გამარჯობა მსოფლიო",  // "Hello World" на грузинском
    userId: "test-" + Date.now(),
    userName: "Quick Test",
    category: "test",
    language: "ka"
  };

  console.log("Creating wish:", wish.text);
  const res = await axios.post('http://45.136.57.119:3000/api/wishes', wish);
  console.log("Created with ID:", res.data.wishId);
  console.log("\nWait 5 seconds and check manually...");
}

quickTest().catch(console.error);
