# 💬 Chat Translation API

## Обзор

API для перевода сообщений в чате между пользователями в рамках матча. Все переводы кэшируются в Firestore для быстрого доступа.

---

## Эндпоинт

```
POST /api/message/translate
```

## Запрос

```json
{
  "matchId": "match_doc_id",
  "messageId": "message_doc_id",
  "targetLang": "ru"
}
```

### Параметры:

- **matchId** (обязательно): ID документа матча
- **messageId** (обязательно): ID сообщения в подколлекции `matches/{matchId}/messages`
- **targetLang** (опционально): Целевой язык для перевода. По умолчанию `"en"`

### Поддерживаемые языки:

`ru`, `en`, `zh`, `es`, `ar`, `de`, `fr`, `ja`, `it`, `ko`, `pt`, `hi`, `th`, и 100+ других через Google Cloud Translate

---

## Ответ

### Успешный (200):

```json
{
  "ok": true,
  "translated": "Привет! Меня интересует ваш MacBook",
  "cached": false,
  "targetLang": "ru",
  "originalLang": "en"
}
```

### Из кэша (200):

```json
{
  "ok": true,
  "translated": "Привет! Меня интересует ваш MacBook",
  "cached": true,
  "targetLang": "ru",
  "originalLang": "en"
}
```

### Ошибки:

**400 Bad Request:**
```json
{
  "ok": false,
  "error": "matchId_required" // или "messageId_required", "text_empty"
}
```

**404 Not Found:**
```json
{
  "ok": false,
  "error": "message_not_found"
}
```

**503 Service Unavailable:**
```json
{
  "ok": false,
  "error": "firebase_unavailable"
}
```

---

## Структура сообщения в Firestore

### Путь:
```
matches/{matchId}/messages/{messageId}
```

### Поля документа:

```javascript
{
  text: "Hello! I'm interested in your MacBook",
  senderId: "user_id_123",
  receiverId: "user_id_456",
  lang: "en",  // Язык оригинального сообщения (автоопределение или from UI)
  createdAt: Timestamp,
  read: false,
  translations: {
    ru: "Привет! Меня интересует ваш MacBook",
    es: "¡Hola! Estoy interesado en tu MacBook",
    ja: "こんにちは！あなたのMacBookに興味があります"
  },
  updatedAt: Timestamp
}
```

---

## Flutter Integration

### 1. Service для перевода сообщений

**Файл: `lib/services/message_translation_service.dart`**

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class MessageTranslationService {
  static const String baseUrl = 'https://your-server.com';

  /// Переводит сообщение на целевой язык
  static Future<String> translateMessage({
    required String matchId,
    required String messageId,
    required String targetLang,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/api/message/translate');
      
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'matchId': matchId,
          'messageId': messageId,
          'targetLang': targetLang,
        }),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['ok'] == true) {
          return data['translated'] ?? '';
        }
      }
      
      print('MessageTranslationService error: ${response.body}');
      return '';
    } catch (e) {
      print('MessageTranslationService error: $e');
      return '';
    }
  }
}
```

### 2. Виджет сообщения с переводом

**Файл: `lib/widgets/translatable_message_bubble.dart`**

```dart
import 'package:flutter/material.dart';
import '../services/message_translation_service.dart';

class TranslatableMessageBubble extends StatefulWidget {
  final String matchId;
  final String messageId;
  final String text;
  final String originalLang;
  final String userLang;
  final bool isMine;

  const TranslatableMessageBubble({
    Key? key,
    required this.matchId,
    required this.messageId,
    required this.text,
    required this.originalLang,
    required this.userLang,
    required this.isMine,
  }) : super(key: key);

  @override
  State<TranslatableMessageBubble> createState() => _TranslatableMessageBubbleState();
}

class _TranslatableMessageBubbleState extends State<TranslatableMessageBubble> {
  bool _showTranslation = false;
  String? _translatedText;
  bool _isTranslating = false;

  bool get _needsTranslation => widget.originalLang != widget.userLang;

  Future<void> _loadTranslation() async {
    if (_translatedText != null) {
      setState(() => _showTranslation = !_showTranslation);
      return;
    }

    setState(() => _isTranslating = true);

    final translated = await MessageTranslationService.translateMessage(
      matchId: widget.matchId,
      messageId: widget.messageId,
      targetLang: widget.userLang,
    );

    setState(() {
      _translatedText = translated;
      _showTranslation = translated.isNotEmpty;
      _isTranslating = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
      child: Align(
        alignment: widget.isMine ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.75,
          ),
          decoration: BoxDecoration(
            color: widget.isMine ? Colors.blue[100] : Colors.grey[200],
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Оригинальный текст или перевод
              Text(
                _showTranslation && _translatedText != null
                    ? _translatedText!
                    : widget.text,
                style: const TextStyle(fontSize: 15),
              ),
              
              // Кнопка перевода (только если язык отличается)
              if (_needsTranslation) ...[
                const SizedBox(height: 8),
                InkWell(
                  onTap: _isTranslating ? null : _loadTranslation,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _showTranslation ? Icons.translate_off : Icons.translate,
                        size: 14,
                        color: Colors.blue[700],
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _isTranslating
                            ? 'Translating...'
                            : _showTranslation
                                ? 'Show original'
                                : 'Translate',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.blue[700],
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
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

### 3. Использование в чате

**Файл: `lib/screens/chat_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../widgets/translatable_message_bubble.dart';

class ChatScreen extends StatelessWidget {
  final String matchId;
  final String currentUserId;
  final String userLang; // Язык пользователя (из настроек)

  const ChatScreen({
    Key? key,
    required this.matchId,
    required this.currentUserId,
    required this.userLang,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat'),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('matches')
            .doc(matchId)
            .collection('messages')
            .orderBy('createdAt', descending: true)
            .snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final messages = snapshot.data!.docs;

          return ListView.builder(
            reverse: true,
            itemCount: messages.length,
            itemBuilder: (context, index) {
              final msg = messages[index];
              final data = msg.data() as Map<String, dynamic>;

              return TranslatableMessageBubble(
                matchId: matchId,
                messageId: msg.id,
                text: data['text'] ?? '',
                originalLang: data['lang'] ?? 'en',
                userLang: userLang,
                isMine: data['senderId'] == currentUserId,
              );
            },
          );
        },
      ),
    );
  }
}
```

---

## Преимущества

✅ **Автоматический перевод** — пользователи могут общаться на разных языках  
✅ **Кэширование** — переводы сохраняются в Firestore, повторные запросы мгновенны  
✅ **Показ оригинала** — можно переключаться между оригиналом и переводом  
✅ **100+ языков** — поддержка всех языков Google Cloud Translate  
✅ **Оффлайн поддержка** — кэшированные переводы доступны без сети  

---

## Тестирование

### 1. Через curl:

```bash
# Создать тестовое сообщение в Firestore вручную:
# Path: matches/test_match_123/messages/test_msg_456
# Data: { text: "Hello! I'm interested", senderId: "user1", lang: "en" }

curl -X POST http://localhost:3000/api/message/translate \
  -H "Content-Type: application/json" \
  -d '{
    "matchId": "test_match_123",
    "messageId": "test_msg_456",
    "targetLang": "ru"
  }'
```

### 2. Ожидаемый результат:

```json
{
  "ok": true,
  "translated": "Привет! Мне интересно",
  "cached": false,
  "targetLang": "ru",
  "originalLang": "en"
}
```

---

**Создавайте глобальное общение без языковых барьеров! 🌍💬✨**
