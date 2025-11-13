# Worker Integration Guide - Document Fields & Processing

## 📋 Overview

This guide describes the document structure and processing flow for client integration with Magic Worker + Firebase.

---

## 🔄 Processing Flow

```
Client creates document → Firebase (status="published") → Worker listener detects →
→ Language detection → Translation to English → Save metadata → Ready for matching
```

**Processing Time:** 2-5 seconds (up to 10s with retries)

---

## 📝 Document Fields

### **Input Fields** (Client Must Provide)

```typescript
{
  // ✅ REQUIRED
  text: string,              // User's intent/wish in any language
  userId: string,            // User ID
  status: "published",       // ⚠️ CRITICAL: Worker only listens to "published"
  
  // ✅ RECOMMENDED
  userName: string,          // User name (default: "Anonymous")
  category: string,          // "automotive", "real-estate", "social", etc.
  
  // ✅ OPTIONAL
  language: string,          // Language hint (auto-detected if omitted)
  location: {                // User location
    lat: number,
    lng: number,
    city: string,
    country: string
  },
  appId: string,             // App identifier (default: "com.magicai.box")
  metadata: object,          // Any additional data
  createdAt: Timestamp,      // Document creation time
  updatedAt: Timestamp       // Last update time
}
```

### **Output Fields** (Worker Adds After Processing)

```typescript
{
  // 🎯 LANGUAGE DETECTION
  sourceLang: string,        // ISO 639-1 language code: "ka", "ru", "en", "ar", etc.
                             // ⭐ USE THIS for client-side language filtering!
  
  // 🔧 WORKER TRACKING
  workerVersion: string,     // "magicbox-worker-2.0" or "magicbox-worker-2.1"
  workerLastRun: Timestamp,  // Last processing timestamp
  workerProcessed: boolean,  // true = processed, false = pending
  
  // 📖 NORMALIZED (English translation)
  normalized: {
    lang: "en",              // Always English
    text: string | null,     // Translated text (null if failed=true)
    detectedLang: string,    // Detected language (same as sourceLang)
    translated: boolean,     // true = translated, false = already English
    provider: string,        // "google" or "vertex"
    providerMs: number,      // Processing time in milliseconds
    failed: boolean,         // ⚠️ true = translation error, false = success
    error: string | null,    // Error message (if failed=true)
    _sourceText: string,     // Original text backup
    _at: Timestamp           // Normalization timestamp
  }
}
```

---

## 🚀 Client Implementation

### 1. Create Document (Firebase SDK)

```dart
// Flutter example
final docRef = await FirebaseFirestore.instance
  .collection('wishes')
  .add({
    'text': userText,
    'userId': currentUser.uid,
    'userName': currentUser.displayName ?? 'Anonymous',
    'category': selectedCategory,
    'status': 'published',  // ⚠️ REQUIRED for Worker processing
    'createdAt': FieldValue.serverTimestamp(),
    'updatedAt': FieldValue.serverTimestamp(),
  });

String wishId = docRef.id;
```

### 2. Wait for Processing

```dart
Future<Map<String, dynamic>> waitForProcessing(String wishId) async {
  final maxWait = Duration(seconds: 10);
  final startTime = DateTime.now();
  
  while (DateTime.now().difference(startTime) < maxWait) {
    final doc = await FirebaseFirestore.instance
      .collection('wishes')
      .doc(wishId)
      .get();
    
    final data = doc.data();
    
    if (data?['workerProcessed'] == true) {
      return data!;
    }
    
    await Future.delayed(Duration(seconds: 1));
  }
  
  throw Exception('Processing timeout');
}
```

### 3. Handle Result

```dart
final wish = await waitForProcessing(wishId);

// Check processing status
if (wish['normalized']?['failed'] == true) {
  // Translation failed
  print('Error: ${wish['normalized']['error']}');
  showError('Translation unavailable');
} else {
  // Success
  final sourceLang = wish['sourceLang'];  // e.g., "ka" for Georgian
  final translatedText = wish['normalized']['text'];
  
  print('Original language: $sourceLang');
  print('English translation: $translatedText');
}
```

### 4. Filter by Language

```dart
// Get all Georgian wishes
final georgianWishes = await FirebaseFirestore.instance
  .collection('wishes')
  .where('sourceLang', isEqualTo: 'ka')
  .where('status', isEqualTo: 'published')
  .get();

// Get all non-English wishes
final nonEnglishWishes = await FirebaseFirestore.instance
  .collection('wishes')
  .where('workerProcessed', isEqualTo: true)
  .where('sourceLang', isNotEqualTo: 'en')
  .get();
```

---

## 🌍 Supported Languages

Worker supports **100+ languages** via Google Translate API.

### Tested Languages:
- ✅ Georgian (ka) - გამარჯობა
- ✅ Arabic (ar) - مرحبا
- ✅ Japanese (ja) - こんにちは
- ✅ Korean (ko) - 안녕하세요
- ✅ Vietnamese (vi) - Xin chào
- ✅ Thai (th) - สวัสดี
- ✅ Turkish (tr) - Merhaba
- ✅ Russian (ru) - Привет
- ✅ Hebrew (he/iw) - שלום
- ✅ Chinese (zh) - 你好
- ✅ And 90+ more...

### Special Cases:
- **Hebrew**: Google returns `iw` (legacy) instead of `he`
- **Chinese**: Auto-detects simplified (zh-CN) or traditional (zh-TW)

---

## ⚠️ Critical Requirements

### 1. Status Field
Worker **ONLY** processes documents with `status: "published"`

❌ **Will NOT process:**
```javascript
{ status: "draft" }
{ status: "pending" }
{ status: "active" }
// or missing status field
```

✅ **Will process:**
```javascript
{ status: "published" }
```

### 2. Collection Names
Worker listens to:
- `wishes` collection
- `intents` collection

### 3. Processing Time
- Normal: **2-4 seconds**
- With retries: **up to 10 seconds**
- **Recommendation**: Wait 5 seconds before checking result

---

## 🛠️ Error Handling

### Processing Failed (normalized.failed = true)

```dart
if (wish['normalized']?['failed'] == true) {
  final error = wish['normalized']['error'];
  
  // Options:
  // 1. Show original text
  displayText(wish['text']);
  
  // 2. Show error to user
  showError('Translation unavailable: $error');
  
  // 3. Retry later (document can be reprocessed)
  scheduleRetry(wishId);
}
```

### Processing Timeout

```dart
try {
  final wish = await waitForProcessing(wishId);
} catch (e) {
  // Processing took too long
  showError('Processing timeout. Please try again.');
}
```

### Missing Fields

```dart
if (wish['workerProcessed'] != true) {
  // Still processing
  showLoadingIndicator();
} else if (wish['normalized'] == null) {
  // Processing error
  showError('Processing incomplete');
} else {
  // Success
  displayTranslation(wish['normalized']['text']);
}
```

---

## 📊 REST API (Optional)

Instead of Firebase SDK, you can use REST API:

### Create Wish
```http
POST http://45.136.57.119:3000/api/wishes
Content-Type: application/json

{
  "text": "გამარჯობა მსოფლიო",
  "userId": "user123",
  "userName": "John Doe",
  "category": "test",
  "language": "ka"
}
```

### Get Wish
```http
GET http://45.136.57.119:3000/api/wishes/{wishId}

Response:
{
  "success": true,
  "wish": {
    "id": "abc123",
    "text": "გამარჯობა მსოფლიო",
    "sourceLang": "ka",
    "normalized": {
      "text": "Hello world",
      "failed": false
    }
  }
}
```

---

## 🔍 Monitoring

### Check Worker Health
```dart
final response = await http.get(
  Uri.parse('http://45.136.57.119:3000/api/stats')
);

final stats = jsonDecode(response.body);
print('Worker uptime: ${stats['stats']['uptime']}s');
print('Firebase connected: ${stats['stats']['firebase']}');
```

---

## 📱 UI Best Practices

### Show Processing State
```dart
enum WishState {
  creating,      // Sending to Firebase
  processing,    // Worker is processing
  success,       // Processed successfully
  failed,        // Processing failed
}

WishState getWishState(Map<String, dynamic> wish) {
  if (wish['workerProcessed'] != true) {
    return WishState.processing;
  }
  
  if (wish['normalized']?['failed'] == true) {
    return WishState.failed;
  }
  
  return WishState.success;
}
```

### Display to User
```dart
Widget buildWishCard(Map<String, dynamic> wish) {
  final state = getWishState(wish);
  
  switch (state) {
    case WishState.processing:
      return LoadingIndicator();
      
    case WishState.failed:
      return ErrorCard(
        message: 'Translation failed',
        originalText: wish['text'],
      );
      
    case WishState.success:
      return SuccessCard(
        originalText: wish['text'],
        translatedText: wish['normalized']['text'],
        language: wish['sourceLang'],
      );
  }
}
```

---

## 🔐 Security Checklist

- [ ] Validate `userId` matches authenticated user
- [ ] Implement rate limiting (max wishes per hour)
- [ ] Sanitize text input (max length, allowed characters)
- [ ] Set up Firestore security rules
- [ ] Enable Firebase App Check for API protection

Example Firestore Rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /wishes/{wishId} {
      // User can only create their own wishes
      allow create: if request.auth != null 
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.status == "published";
      
      // User can read their own wishes
      allow read: if request.auth != null 
        && resource.data.userId == request.auth.uid;
      
      // Worker can update any wish (server-side)
      allow update: if request.auth.token.workerService == true;
    }
  }
}
```

---

## 📞 Technical Support

- **Worker Version**: 2.1 (with retry logic)
- **Server**: http://45.136.57.119:3000
- **GitHub**: https://github.com/skypol2113/magic-worker
- **Processing Success Rate**: 90%+ for all languages

## 🔄 Changelog

### v2.1 (Current - November 2025)
- ✅ Added retry logic (3 attempts, exponential backoff)
- ✅ Added `sourceLang` field for client-side filtering
- ✅ Added `workerVersion`, `workerLastRun`, `workerProcessed` tracking
- ✅ Improved error handling with `normalized.failed` flag
- ✅ Support for 100+ languages including rare ones (Georgian, Thai, etc.)
- ✅ Graceful fallback when translation fails

### v2.0
- Initial release with basic translation support
