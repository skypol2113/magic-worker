// worker/translators/vertex.js
const { VertexAI } = require('@google-cloud/vertexai');


const project = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.VERTEX_LOCATION || 'us-central1';
const vertexAI = new VertexAI({ project, location });
const model = vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash' });


async function detectLanguage(text) {
const prompt = `Detect the language ISO-639-1 code for the following text. Only output the 2-letter code.\nText: ${text}`;
const res = await model.generateContent(prompt);
const out = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'und';
return out.toLowerCase().slice(0,2);
}


async function translateToEn(text, sourceLang) {
const langLine = sourceLang && sourceLang !== 'auto' ? `from ${sourceLang}` : 'from auto-detected language';
const prompt = `Translate the following text ${langLine} to English. Preserve meaning, be concise. Output only the translation.\n---\n${text}`;
const t0 = Date.now();
const res = await model.generateContent(prompt);
const ms = Date.now() - t0;
const out = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
return { text: out.trim(), provider: 'vertex', ms };
}


module.exports = { detectLanguage, translateToEn };