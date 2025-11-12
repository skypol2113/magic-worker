# Flutter App Phase 1: Пошаговое руководство

## Текущий статус (God-Mode)

✅ **Режим бога активен на бэкенде**: все функции доступны  
✅ Ассистент возвращает рекомендации с семантическими тегами (facets)  
✅ Переводы матчей работают через `/api/match/translate`  
✅ Лимиты активны: 10 интентов, cooldown 60 сек  

⚠️ **Задача для UI**: Показать переводы + кнопку "Оригинал", добавить легкое напоминание о временности god-mode

---

## Шаг 1: Индикатор лимитов на экране создания интента

### 1.1. Сервис для статистики пользователя

**Создать файл: `lib/services/user_stats_service.dart`**

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class UserStats {
  final int activeIntents;
  final int maxIntents;
  final int cooldownRemaining;
  final bool godMode;

  const UserStats({
    required this.activeIntents,
    required this.maxIntents,
    required this.cooldownRemaining,
    required this.godMode,
  });

  factory UserStats.fromJson(Map<String, dynamic> json) {
    return UserStats(
      activeIntents: json['activeIntents'] ?? 0,
      maxIntents: json['maxIntents'] ?? 10,
      cooldownRemaining: json['cooldownRemaining'] ?? 0,
      godMode: json['godMode'] ?? false,
    );
  }

  bool get canPublish => cooldownRemaining == 0 && activeIntents < maxIntents;
  bool get limitReached => activeIntents >= maxIntents;
  String get limitsText => '$activeIntents/$maxIntents active intents';
}

class UserStatsService {
  static const String baseUrl = 'http://45.136.57.119:3000';

  static Future<UserStats> fetchStats(String uid) async {
    final uri = Uri.parse('$baseUrl/api/user/stats?uid=$uid');
    
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 5));
      
      if (response.statusCode == 200) {
        final json = jsonDecode(response.body);
        return UserStats.fromJson(json);
      } else {
        throw Exception('Failed to fetch stats: ${response.statusCode}');
      }
    } catch (e) {
      print('UserStatsService error: $e');
      rethrow;
    }
  }
}
```

### 1.2. Обновить экран создания интента (Intent Form)

**В файле (например) `lib/screens/create_intent_screen.dart`:**

```dart
import 'package:flutter/material.dart';
import '../services/user_stats_service.dart';

class CreateIntentScreen extends StatefulWidget {
  const CreateIntentScreen({Key? key}) : super(key: key);

  @override
  State<CreateIntentScreen> createState() => _CreateIntentScreenState();
}

class _CreateIntentScreenState extends State<CreateIntentScreen> {
  final TextEditingController _textController = TextEditingController();
  UserStats? _stats;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    setState(() => _loading = true);
    try {
      final uid = 'current_user_id'; // Получить из Auth
      final stats = await UserStatsService.fetchStats(uid);
      setState(() {
        _stats = stats;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      // Fallback: разрешить публикацию без лимитов
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create Intent')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Индикатор god-mode
            if (_stats?.godMode == true)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  border: Border.all(color: Colors.amber.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, color: Colors.amber.shade700),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '✨ God Mode Active: All Pro features enabled for testing. Limits will apply after launch.',
                        style: TextStyle(fontSize: 13, color: Colors.amber.shade900),
                      ),
                    ),
                  ],
                ),
              ),

            // Лимиты
            if (_stats != null && !_loading)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: _stats!.limitReached ? Colors.red.shade50 : Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _stats!.limitsText,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: _stats!.limitReached ? Colors.red.shade700 : Colors.blue.shade700,
                      ),
                    ),
                    if (_stats!.cooldownRemaining > 0)
                      Text(
                        'Next in ${_stats!.cooldownRemaining}s',
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
                      ),
                  ],
                ),
              ),

            // Поле ввода
            TextField(
              controller: _textController,
              maxLines: 4,
              maxLength: 300,
              decoration: const InputDecoration(
                hintText: 'I want to...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),

            // Кнопка публикации
            ElevatedButton(
              onPressed: (_stats?.canPublish ?? true) ? _publishIntent : null,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: _loading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      _stats?.limitReached == true
                          ? 'Limit Reached (${_stats!.maxIntents})'
                          : _stats?.cooldownRemaining ?? 0 > 0
                              ? 'Wait ${_stats!.cooldownRemaining}s'
                              : 'Publish Intent',
                    ),
            ),

            // Подсказка при достижении лимита
            if (_stats?.limitReached == true)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  'You have reached the maximum of ${_stats!.maxIntents} active intents. Please complete or archive some first.',
                  style: TextStyle(fontSize: 13, color: Colors.red.shade600),
                  textAlign: TextAlign.center,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _publishIntent() async {
    final text = _textController.text.trim();
    if (text.length < 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Text too short (min 10 chars)')),
      );
      return;
    }

    // TODO: Вызвать API /api/wish
    // После успеха: _loadStats() для обновления лимитов
    
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Intent published!')),
    );
    
    _textController.clear();
    await _loadStats();
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }
}
```

---

## Шаг 2: Экран MatchDetail с переводом + кнопка "Оригинал"

### 2.1. Сервис для переводов матчей

**Создать файл: `lib/services/match_translation_service.dart`**

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class MatchTranslationService {
  static const String baseUrl = 'http://45.136.57.119:3000';

  static Future<String> translateMatchField({
    required String matchId,
    required String targetLang,
    String field = 'bText',
  }) async {
    final uri = Uri.parse('$baseUrl/api/match/translate');
    
    try {
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'matchId': matchId,
          'targetLang': targetLang,
          'field': field,
        }),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final json = jsonDecode(response.body);
        return json['translated'] ?? '';
      } else {
        throw Exception('Translation failed: ${response.statusCode}');
      }
    } catch (e) {
      print('MatchTranslationService error: $e');
      rethrow;
    }
  }
}
```

### 2.2. Виджет MatchDetail с переключателем перевода

**Создать или обновить: `lib/screens/match_detail_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/match_translation_service.dart';

class MatchDetailScreen extends StatefulWidget {
  final String matchId;
  final String originalText;
  final String userInterfaceLang; // 'en', 'ru', etc.

  const MatchDetailScreen({
    Key? key,
    required this.matchId,
    required this.originalText,
    required this.userInterfaceLang,
  }) : super(key: key);

  @override
  State<MatchDetailScreen> createState() => _MatchDetailScreenState();
}

class _MatchDetailScreenState extends State<MatchDetailScreen> {
  bool _showOriginal = false;
  String? _translatedText;
  bool _loadingTranslation = false;

  @override
  void initState() {
    super.initState();
    _loadTranslation();
  }

  Future<void> _loadTranslation() async {
    if (widget.userInterfaceLang == 'en') {
      // Язык оригинала совпадает с UI, не переводим
      setState(() => _translatedText = widget.originalText);
      return;
    }

    setState(() => _loadingTranslation = true);
    
    try {
      final translated = await MatchTranslationService.translateMatchField(
        matchId: widget.matchId,
        targetLang: widget.userInterfaceLang,
        field: 'bText',
      );
      setState(() {
        _translatedText = translated;
        _loadingTranslation = false;
      });
    } catch (e) {
      setState(() {
        _translatedText = widget.originalText; // fallback
        _loadingTranslation = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final displayText = _showOriginal ? widget.originalText : (_translatedText ?? widget.originalText);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Match Details'),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: displayText));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Copied to clipboard')),
              );
            },
            tooltip: 'Copy text',
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // God-mode reminder
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                border: Border.all(color: Colors.green.shade300),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.verified, color: Colors.green.shade700),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '✨ Translation is a Pro feature — currently free in God Mode for all users.',
                      style: TextStyle(fontSize: 13, color: Colors.green.shade900),
                    ),
                  ),
                ],
              ),
            ),

            // Текст матча
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey.shade300),
              ),
              child: _loadingTranslation
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(20),
                        child: CircularProgressIndicator(),
                      ),
                    )
                  : Text(
                      displayText,
                      style: const TextStyle(fontSize: 16, height: 1.5),
                    ),
            ),

            const SizedBox(height: 16),

            // Переключатель Original/Translated
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  _showOriginal ? Icons.language_outlined : Icons.translate,
                  size: 20,
                  color: Colors.blue.shade700,
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: () {
                    setState(() => _showOriginal = !_showOriginal);
                  },
                  child: Text(
                    _showOriginal ? 'Show Translation' : 'Show Original',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),

            const Spacer(),

            // Кнопка действия
            ElevatedButton(
              onPressed: () {
                // TODO: Accept match / Start contact
              },
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: const Text('Accept Match'),
            ),
          ],
        ),
      ),
    );
  }
}
```

---

## Шаг 3: Ассистент с фасетами (отображение тегов)

### 3.1. Модель ответа ассистента

**Создать файл: `lib/models/assist_suggestion.dart`**

```dart
class AssistSuggestion {
  final String text;
  final List<String> facets;

  const AssistSuggestion({
    required this.text,
    required this.facets,
  });

  factory AssistSuggestion.fromJson(Map<String, dynamic> json) {
    return AssistSuggestion(
      text: json['text'] ?? '',
      facets: (json['facets'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
    );
  }
}

class AssistResponse {
  final List<AssistSuggestion> items;
  final bool godMode;
  final int ms;

  const AssistResponse({
    required this.items,
    required this.godMode,
    required this.ms,
  });

  factory AssistResponse.fromJson(Map<String, dynamic> json) {
    return AssistResponse(
      items: (json['items'] as List<dynamic>?)
              ?.map((e) => AssistSuggestion.fromJson(e))
              .toList() ??
          [],
      godMode: json['godMode'] ?? false,
      ms: json['ms'] ?? 0,
    );
  }
}
```

### 3.2. Виджет карточки рекомендации с тегами

**Обновить виджет рекомендаций (например, в `lib/widgets/assist_suggestion_card.dart`):**

```dart
import 'package:flutter/material.dart';
import '../models/assist_suggestion.dart';

class AssistSuggestionCard extends StatelessWidget {
  final AssistSuggestion suggestion;
  final VoidCallback onTap;

  const AssistSuggestionCard({
    Key? key,
    required this.suggestion,
    required this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Текст рекомендации
              Text(
                suggestion.text,
                style: const TextStyle(fontSize: 15, height: 1.4),
              ),
              
              // Фасеты (теги)
              if (suggestion.facets.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: suggestion.facets.map((facet) {
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.blue.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.blue.shade200),
                      ),
                      child: Text(
                        facet,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.blue.shade700,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
```

### 3.3. Интеграция в экран создания интента

**В `lib/screens/create_intent_screen.dart` (обновить секцию ассистента):**

```dart
// После поля ввода добавить:
if (_assistSuggestions.isNotEmpty) ...[
  const SizedBox(height: 16),
  const Text(
    '💡 AI Suggestions:',
    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
  ),
  const SizedBox(height: 8),
  ListView.builder(
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    itemCount: _assistSuggestions.length,
    itemBuilder: (context, index) {
      final suggestion = _assistSuggestions[index];
      return AssistSuggestionCard(
        suggestion: suggestion,
        onTap: () {
          _textController.text = suggestion.text;
          setState(() => _assistSuggestions.clear());
        },
      );
    },
  ),
],
```

---

## Шаг 4: Напоминание о god-mode на главном экране

### 4.1. Баннер на Home Screen

**В `lib/screens/home_screen.dart`:**

```dart
@override
Widget build(BuildContext context) {
  return Scaffold(
    appBar: AppBar(title: const Text('MagicAIbox')),
    body: Column(
      children: [
        // God-mode banner
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: Colors.purple.shade50,
          child: Row(
            children: [
              Icon(Icons.stars, color: Colors.purple.shade700, size: 24),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '✨ God Mode Active',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Colors.purple.shade900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'All Pro features are free during testing. Enjoy!',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.purple.shade700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        // Остальной контент экрана
        Expanded(
          child: ListView(
            // ...
          ),
        ),
      ],
    ),
  );
}
```

---

## Шаг 5: Donate Button (заглушка)

### 5.1. Добавить кнопку в Settings/Profile

**В `lib/screens/settings_screen.dart`:**

```dart
ListTile(
  leading: Icon(Icons.favorite, color: Colors.red.shade400),
  title: const Text('Support MagicAIbox'),
  subtitle: const Text('Buy us a coffee ☕'),
  trailing: const Icon(Icons.arrow_forward_ios, size: 16),
  onTap: () {
    _showDonateDialog(context);
  },
),

// Диалог
void _showDonateDialog(BuildContext context) {
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Row(
        children: [
          Icon(Icons.favorite, color: Colors.red.shade400),
          const SizedBox(width: 8),
          const Text('Support Us'),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'If you enjoy MagicAIbox, consider supporting development:',
            style: TextStyle(fontSize: 14),
          ),
          const SizedBox(height: 16),
          _DonateButton(
            icon: Icons.coffee,
            label: 'Buy Me a Coffee',
            url: 'https://buymeacoffee.com/magicaibox', // TODO: заменить
          ),
          const SizedBox(height: 8),
          _DonateButton(
            icon: Icons.payments,
            label: 'Boosty',
            url: 'https://boosty.to/magicaibox', // TODO: заменить
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Close'),
        ),
      ],
    ),
  );
}

class _DonateButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final String url;

  const _DonateButton({
    required this.icon,
    required this.label,
    required this.url,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: () async {
        // TODO: launch url_launcher
        print('Open $url');
      },
      icon: Icon(icon, size: 20),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, 44),
      ),
    );
  }
}
```

---

## Шаг 6: Тестирование UI

### 6.1. Тест создания интента с лимитами

1. Открыть CreateIntentScreen
2. Убедиться, что виден баннер "God Mode Active"
3. Проверить счетчик "X/10 active intents"
4. Создать интент → счетчик увеличился
5. Попытаться создать сразу ещё один → увидеть "Wait Xs"
6. Через 60 сек → можно снова

### 6.2. Тест MatchDetail с переводом

1. Открыть матч с текстом на английском
2. Если язык UI — русский → увидеть перевод
3. Нажать "Show Original" → увидеть английский текст
4. Нажать кнопку копирования → текст в буфере обмена
5. Увидеть зелёный баннер про God Mode

### 6.3. Тест ассистента с фасетами

1. Ввести "I want to teach guitar"
2. Нажать на иконку ассистента (или он автоматически вызывается)
3. Увидеть 3-5 рекомендаций
4. Под каждой рекомендацией — теги (learning, teaching, music, etc.)
5. Кликнуть на рекомендацию → текст подставился в поле

---

## Чек-лист готовности Flutter Phase 1

- [ ] God-mode баннер на главном экране
- [ ] Индикатор лимитов (X/10 intents) на CreateIntentScreen
- [ ] Cooldown таймер отображается ("Wait Xs")
- [ ] Кнопка "Publish Intent" заблокирована при лимите/cooldown
- [ ] MatchDetail показывает перевод по умолчанию (если lang != original)
- [ ] Кнопка "Show Original" переключает на оригинальный текст
- [ ] Кнопка копирования текста работает
- [ ] Баннер о god-mode на MatchDetail
- [ ] Ассистент возвращает фасеты и они отображаются как теги
- [ ] Donate кнопка в Settings (заглушка с диалогом)
- [ ] Все тексты на английском (или поддерживают интернационализацию)

---

## Примеры API запросов из Flutter

### Статистика пользователя

```dart
final response = await http.get(
  Uri.parse('http://45.136.57.119:3000/api/user/stats?uid=user123'),
);
final stats = UserStats.fromJson(jsonDecode(response.body));
```

### Публикация интента

```dart
final response = await http.post(
  Uri.parse('http://45.136.57.119:3000/api/wish'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'text': 'I want to learn Spanish',
    'userId': 'user123',
    'userName': 'John Doe',
  }),
);
```

### Перевод матча

```dart
final response = await http.post(
  Uri.parse('http://45.136.57.119:3000/api/match/translate'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'matchId': 'match_xyz',
    'targetLang': 'ru',
    'field': 'bText',
  }),
);
final translated = jsonDecode(response.body)['translated'];
```

### Ассистент

```dart
final response = await http.post(
  Uri.parse('http://45.136.57.119:3000/api/assist/continue'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'text': 'I want to teach guitar',
    'lang': 'en',
    'uid': 'user123',
  }),
);
final assistResponse = AssistResponse.fromJson(jsonDecode(response.body));
```

---

## Следующие шаги

После завершения Phase 1:
- Добавить анимации для плавного UX
- Локализация на 8 языков (i18n)
- Интеграция аналитики (Firebase Analytics/Mixpanel)
- Подключить реальные donate провайдеры (Boosty/Stripe)
- Тестирование на разных устройствах (iOS/Android)
- Подготовка к публикации в Store (скриншоты, описания)
