# 🌍 Translation Strategy: Light vs Pro

## ⚠️ Статус реализации

**Текущий worker (v1):**
- ✅ Translation API готов (`/api/match/translate`, `/api/message/translate`)
- ✅ Multilingual matching работает (100+ языков)
- ✅ Direction filtering реализован (sell↔buy, offer↔seek)
- ⚠️ **Light/Pro разделение** — будет в **worker v2** после рефакторинга

**Архитектура v1 (текущая):**
```
index.js (монолит ~1800 строк)
├── Firestore listeners
├── Matching logic
├── Translation endpoints
└── Push notifications
```

**Архитектура v2 (планируется):**
```
magic-worker-v2/
├── listener/          # Отдельный процесс
├── matcher/           # + subscription filter ← ЗДЕСЬ Light/Pro
├── translator/        # Изолированный сервис
└── api/              # REST endpoints
```

---

## Бизнес-модель

### 💡 Light Version (Free)
**Матчинг только одинаковых языков:**
- Русский ↔ Русский ✅
- Английский ↔ Английский ✅
- Японский ↔ Японский ✅
- **БЕЗ переводов** — пользователи общаются только на одном языке

**Преимущества:**
- ✅ Бесплатно
- ✅ Быстрый матчинг (меньше кандидатов)
- ✅ Проще понимание (одинаковая культура)
- ✅ Нет расходов на Google Translate API

### 🌟 Pro Version (Paid)
**Глобальный мультиязычный матчинг:**
- Русский ↔ Английский ✅
- Японский ↔ Испанский ✅
- Арабский ↔ Французский ✅
- **С автопереводом** — общение без языковых барьеров

**Преимущества:**
- 🌍 Глобальная аудитория (в 100 раз больше кандидатов)
- 💬 Автоперевод интентов на странице матчей
- 💬 Автоперевод сообщений в чате
- 🔄 Кнопка "Оригинал" для проверки текста
- 📈 Больше matches = больше возможностей

---

## 📋 Checklist для Flutter приложения

### ✅ 1. Страница Match Details

**Нужно проверить:**

#### A. Показ текста встречного интента
```dart
// lib/screens/match_detail_screen.dart

// Для Light версии (только оригинал):
Text(match.bText)

// Для Pro версии (с переводом):
_showOriginal 
  ? Text(match.bText)  // Оригинал
  : Text(_translatedText ?? match.bText)  // Перевод
```

#### B. Кнопка переключения Перевод/Оригинал
```dart
Row(
  children: [
    Icon(_showOriginal ? Icons.language_off : Icons.translate),
    TextButton(
      onPressed: () => setState(() => _showOriginal = !_showOriginal),
      child: Text(_showOriginal ? 'Show Translation' : 'Show Original'),
    ),
  ],
)
```

#### C. Индикатор языка оригинала
```dart
Chip(
  avatar: Icon(Icons.flag),
  label: Text('Original: ${match.bLang ?? "Unknown"}'),
)
```

### ✅ 2. Экран чата (Messages)

**Нужно проверить:**

#### A. Виджет сообщения с переводом
```dart
// lib/widgets/translatable_message_bubble.dart

class TranslatableMessageBubble extends StatefulWidget {
  final Message message;
  final String userLang;
  final bool isPro;  // ← NEW: флаг Pro подписки
  
  // ...
}
```

#### B. Кнопка перевода (только для Pro)
```dart
if (widget.isPro && _needsTranslation) ...[
  TextButton.icon(
    icon: Icon(Icons.translate),
    label: Text('Translate'),
    onPressed: _loadTranslation,
  ),
]
```

#### C. Плашка "Upgrade to Pro" для Light
```dart
if (!widget.isPro && _needsTranslation) ...[
  Container(
    color: Colors.amber.shade100,
    padding: EdgeInsets.all(8),
    child: Row(
      children: [
        Icon(Icons.lock, size: 16),
        SizedBox(width: 8),
        Text('Upgrade to Pro for translation'),
        Spacer(),
        TextButton(
          child: Text('Upgrade'),
          onPressed: () => _navigateToSubscription(),
        ),
      ],
    ),
  ),
]
```

### ✅ 3. Логика матчинга на backend

**Уже реализовано:**
- ✅ `isCounterpartDirection()` — проверка встречных направлений
- ✅ `getNormalizedText()` — нормализация через перевод на EN
- ✅ Semantic similarity с порогом 0.75

**Нужно добавить проверку языка для Light:**

```javascript
// В selectCounterpartsForIntent() перед similarity check

// Check subscription level
const userDoc = await db.collection('users').doc(srcData.userId).get();
const subscription = userDoc.data()?.subscription || 'light';

if (subscription === 'light') {
  // Light: match only same language
  const srcLang = srcData.lang || 'en';
  const targetLang = x.lang || 'en';
  
  if (srcLang !== targetLang) {
    return null; // Skip different languages for Light users
  }
}

// Pro: match any language (existing logic)
```

---

## 🔧 Реализация на Flutter

### 1. Модель подписки

**Файл: `lib/models/subscription.dart`**

```dart
enum SubscriptionTier {
  light,
  pro,
}

class Subscription {
  final SubscriptionTier tier;
  final DateTime? expiresAt;
  final bool isActive;

  Subscription({
    required this.tier,
    this.expiresAt,
    required this.isActive,
  });

  bool get isPro => tier == SubscriptionTier.pro && isActive;
  bool get canTranslate => isPro;
  bool get canMatchGlobally => isPro;

  factory Subscription.fromFirestore(Map<String, dynamic>? data) {
    if (data == null) {
      return Subscription(
        tier: SubscriptionTier.light,
        isActive: true,
      );
    }

    return Subscription(
      tier: data['tier'] == 'pro' 
          ? SubscriptionTier.pro 
          : SubscriptionTier.light,
      expiresAt: data['expiresAt']?.toDate(),
      isActive: data['isActive'] ?? true,
    );
  }
}
```

### 2. Provider для подписки

**Файл: `lib/providers/subscription_provider.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/subscription.dart';

class SubscriptionProvider with ChangeNotifier {
  Subscription _subscription = Subscription(
    tier: SubscriptionTier.light,
    isActive: true,
  );

  Subscription get subscription => _subscription;
  bool get isPro => _subscription.isPro;

  Future<void> loadSubscription(String userId) async {
    final doc = await FirebaseFirestore.instance
        .collection('users')
        .doc(userId)
        .get();
    
    _subscription = Subscription.fromFirestore(doc.data());
    notifyListeners();
  }

  Future<void> upgradeToPro(String userId) async {
    // Integration with payment gateway
    // ...
    
    await FirebaseFirestore.instance
        .collection('users')
        .doc(userId)
        .update({
      'subscription': {
        'tier': 'pro',
        'isActive': true,
        'activatedAt': FieldValue.serverTimestamp(),
      }
    });

    await loadSubscription(userId);
  }
}
```

### 3. Updated MatchDetail Screen

**Файл: `lib/screens/match_detail_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/subscription_provider.dart';
import '../services/match_translation_service.dart';

class MatchDetailScreen extends StatefulWidget {
  final String matchId;
  final Map<String, dynamic> matchData;

  const MatchDetailScreen({
    Key? key,
    required this.matchId,
    required this.matchData,
  }) : super(key: key);

  @override
  State<MatchDetailScreen> createState() => _MatchDetailScreenState();
}

class _MatchDetailScreenState extends State<MatchDetailScreen> {
  bool _showOriginal = false;
  String? _translatedText;
  bool _isTranslating = false;

  @override
  void initState() {
    super.initState();
    final subscription = context.read<SubscriptionProvider>().subscription;
    if (subscription.isPro) {
      _loadTranslation();
    }
  }

  Future<void> _loadTranslation() async {
    if (_translatedText != null) return;

    setState(() => _isTranslating = true);

    try {
      final userLang = 'ru'; // Get from user preferences
      final translated = await MatchTranslationService.translateMatchField(
        matchId: widget.matchId,
        targetLang: userLang,
        field: 'bText',
      );

      setState(() {
        _translatedText = translated;
        _isTranslating = false;
      });
    } catch (e) {
      setState(() => _isTranslating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final subscription = context.watch<SubscriptionProvider>().subscription;
    final bText = widget.matchData['bText'] ?? '';
    final bLang = widget.matchData['bLang'] ?? 'unknown';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Match Details'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Subscription badge
            _buildSubscriptionBadge(subscription),
            
            const SizedBox(height: 16),

            // Intent text with translation
            _buildIntentText(subscription, bText, bLang),

            const SizedBox(height: 24),

            // Contact button
            ElevatedButton.icon(
              icon: const Icon(Icons.chat),
              label: const Text('Start Chat'),
              onPressed: () => _navigateToChat(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSubscriptionBadge(Subscription subscription) {
    if (subscription.isPro) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [Colors.purple.shade400, Colors.blue.shade400],
          ),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            const Icon(Icons.workspace_premium, color: Colors.white),
            const SizedBox(width: 8),
            const Text(
              'PRO: Global matches with auto-translation',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade200,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.language_off, color: Colors.grey.shade600),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Light: Matches in your language only',
              style: TextStyle(color: Colors.grey.shade700),
            ),
          ),
          TextButton(
            child: const Text('Upgrade'),
            onPressed: () => _navigateToUpgrade(),
          ),
        ],
      ),
    );
  }

  Widget _buildIntentText(Subscription subscription, String text, String lang) {
    final displayText = _showOriginal || !subscription.isPro
        ? text
        : (_translatedText ?? text);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Language indicator
            Chip(
              avatar: const Icon(Icons.flag, size: 16),
              label: Text('Original language: ${lang.toUpperCase()}'),
            ),
            
            const SizedBox(height: 12),

            // Text
            if (_isTranslating)
              const Center(child: CircularProgressIndicator())
            else
              Text(
                displayText,
                style: const TextStyle(fontSize: 16),
              ),

            // Translation toggle (Pro only)
            if (subscription.isPro && _translatedText != null) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                icon: Icon(_showOriginal ? Icons.translate : Icons.language_off),
                label: Text(_showOriginal ? 'Show Translation' : 'Show Original'),
                onPressed: () {
                  setState(() => _showOriginal = !_showOriginal);
                },
              ),
            ],

            // Upgrade prompt (Light only)
            if (!subscription.isPro && lang != 'ru') ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  border: Border.all(color: Colors.amber.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(Icons.lock, color: Colors.amber.shade700),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text('Upgrade to Pro for auto-translation'),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  void _navigateToChat() {
    // Navigate to chat screen
  }

  void _navigateToUpgrade() {
    // Navigate to subscription upgrade screen
  }
}
```

---

## 🎯 План внедрения

### ⚠️ ВАЖНО: Архитектура

**Light/Pro функционал будет внедрен в НОВОМ worker после рефакторинга:**

```
magic-worker-v2/
├── listener/          # Firestore listeners (intents, wishes, users)
├── matcher/           # Matching logic с проверкой подписки
├── translator/        # Translation service (GCT/Vertex)
├── api/              # REST endpoints
│   ├── match.js      # /api/match/translate
│   ├── message.js    # /api/message/translate
│   └── subscription.js # /api/user/subscription
└── scheduler/        # Cron jobs (cleanup, recovery)
```

### Backend (Worker v2) — После рефакторинга

**В новой архитектуре:**

1. **Модуль `matcher/subscriptionFilter.js`:**
   ```javascript
   // Light users: match only same language
   async function filterBySubscription(srcUser, candidates) {
     const subscription = await getSubscription(srcUser.id);
     
     if (subscription.tier === 'light') {
       // Filter candidates: only same language
       return candidates.filter(c => 
         c.lang === srcUser.lang || 
         (!c.lang && !srcUser.lang) // both undefined = OK
       );
     }
     
     // Pro: return all candidates (multilingual)
     return candidates;
   }
   ```

2. **Новый API endpoint в `api/subscription.js`:**
   ```javascript
   app.get('/api/user/subscription/:userId', async (req, res) => {
     const userDoc = await db.collection('users').doc(req.params.userId).get();
     const subscription = userDoc.data()?.subscription || { tier: 'light' };
     res.json({ ok: true, subscription });
   });
   ```

3. **Интеграция в `matcher/index.js`:**
   ```javascript
   // После semantic similarity check
   const filteredCandidates = await filterBySubscription(srcUser, candidates);
   ```

### Frontend (Flutter)

**Приоритет 1 (Критично):**
- [ ] Добавить модель `Subscription` и provider
- [ ] Обновить `MatchDetailScreen` с проверкой подписки
- [ ] Показывать плашку "Upgrade to Pro" для Light пользователей
- [ ] Кнопка перевода/оригинала для Pro пользователей

**Приоритет 2 (Важно):**
- [ ] Обновить `TranslatableMessageBubble` для чата
- [ ] Ограничить переводы для Light версии
- [ ] Экран upgrade/subscription с ценами

**Приоритет 3 (Желательно):**
- [ ] A/B тестирование цен
- [ ] Аналитика конверсии Light → Pro
- [ ] Push уведомление "You got a match in English! Upgrade to chat"

---

## 💰 Pricing Strategy

### Предложенные цены:

**Light (Free):**
- ✅ Unlimited matches (same language)
- ✅ Chat без переводов
- ✅ Базовые фильтры

**Pro (Paid):**
- 🌟 $4.99/month или $49.99/year (save 17%)
- 🌍 Global matches (100+ languages)
- 💬 Auto-translation (intents + chat)
- 🔄 Show original/translation toggle
- 📊 Priority support

---

## ✅ Тестирование

### Сценарий 1: Light пользователь
1. Создать интент на русском
2. Система матчит только русские интенты
3. На странице Match Details — только оригинал
4. В чате — сообщения без перевода
5. Показывать "Upgrade to Pro" баннер

### Сценарий 2: Pro пользователь
1. Создать интент на русском
2. Система матчит все языки (японский, английский и т.д.)
3. На странице Match Details — автоперевод + кнопка "Оригинал"
4. В чате — кнопка "Translate" под каждым сообщением
5. Кэширование переводов работает

---

**Монетизация через языковой барьер — отличная стратегия! 💰🌍**
