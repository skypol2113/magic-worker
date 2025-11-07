const admin = require('firebase-admin');
const config = require('./env');

// Инициализация Firebase с вашим корректным .env форматом
const serviceAccount = {
  type: "service_account",
  project_id: process.env.project_id,  // ← БЕЗ FIREBASE_ префикса!
  private_key_id: process.env.private_key_id,
  private_key: process.env.private_key?.replace(/\\n/g, '\n'),
  client_email: process.env.client_email,
  client_id: process.env.client_id,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.client_x509_cert_url,
  universe_domain: "googleapis.com"
};

console.log('🔧 Firebase config check:');
console.log('Project ID:', serviceAccount.project_id);
console.log('Client Email:', serviceAccount.client_email);
console.log('Private Key exists:', !!serviceAccount.private_key);

// Инициализируем Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
    storageBucket: `${serviceAccount.project_id}.appspot.com`
  });

  const db = admin.firestore();
  const auth = admin.auth();
  const storage = admin.storage();
  const messaging = admin.messaging();

  console.log('✅ Firebase initialized successfully for project:', serviceAccount.project_id);

  // Коллекции для Magic Box App
  const COLLECTIONS = {
    WISHES: 'wishes',
    MATCHES: 'matches', 
    USERS: 'users',
    CONVERSATIONS: 'chats',
    ANALYTICS: 'analytics'
  };

  module.exports = {
    admin,
    db,
    auth,
    storage,
    messaging,
    COLLECTIONS
  };

} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  
  // Экспортируем заглушки для возможности работы без Firebase
  module.exports = {
    admin: null,
    db: null,
    auth: null,
    storage: null,
    messaging: null,
    COLLECTIONS: {
      WISHES: 'wishes',
      MATCHES: 'matches',
      USERS: 'users',
      CONVERSATIONS: 'chats', 
      ANALYTICS: 'analytics'
    }
  };
}