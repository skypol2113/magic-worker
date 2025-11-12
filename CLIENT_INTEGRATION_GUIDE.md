# 🪄 Магический Ассистент — Клиентская Интеграция

## Что изменилось?

Ассистент теперь **не просто анализирует интент**, а **задаёт умные вопросы**, помогая пользователю создать детальный интент, который естественно достигнет **75%+ similarity** для успешного матчинга!

## Быстрый старт

### 1. API запрос (без изменений)

```dart
final response = await http.post(
  Uri.parse('https://your-server.com/api/assist/continue'),
  headers: {'Content-Type': 'application/json'},
  body: jsonEncode({
    'text': userText,
    'lang': 'ru',
    'uid': currentUserId,
  }),
);

final data = jsonDecode(response.body);
```

### 2. Новое поле в ответе: `smartQuestions`

```json
{
  "ok": true,
  "items": [{
    "text": "Улучшенный текст интента",
    "smartQuestions": [
      {
        "field": "price",
        "question": "Какая цена?",
        "why": "Покупатели ищут в своём бюджете"
      },
      {
        "field": "location",
        "question": "Где находится?",
        "why": "Найдём покупателей поблизости"
      }
    ],
    ... // другие поля
  }]
}
```

### 3. Отображение в UI (Flutter пример)

```dart
class SmartQuestionsWidget extends StatelessWidget {
  final List<SmartQuestion> questions;
  final Function(String field, String answer) onAnswer;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '💡 Несколько вопросов для лучшего результата',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
        SizedBox(height: 12),
        ...questions.map((q) => _buildQuestionCard(q)),
      ],
    );
  }

  Widget _buildQuestionCard(SmartQuestion q) {
    return Card(
      margin: EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.help_outline, size: 20, color: Colors.purple),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    q.question,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
            SizedBox(height: 4),
            Text(
              q.why,
              style: TextStyle(fontSize: 12, color: Colors.grey[600]),
            ),
            SizedBox(height: 8),
            TextField(
              decoration: InputDecoration(
                hintText: 'Ваш ответ...',
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              ),
              onSubmitted: (answer) => onAnswer(q.field, answer),
            ),
          ],
        ),
      ),
    );
  }
}
```

### 4. Модель данных

```dart
class SmartQuestion {
  final String field;
  final String question;
  final String why;

  SmartQuestion({
    required this.field,
    required this.question,
    required this.why,
  });

  factory SmartQuestion.fromJson(Map<String, dynamic> json) {
    return SmartQuestion(
      field: json['field'] ?? '',
      question: json['question'] ?? '',
      why: json['why'] ?? '',
    );
  }
}

class AssistItem {
  final String text;
  final List<SmartQuestion> smartQuestions;
  // ... другие поля

  factory AssistItem.fromJson(Map<String, dynamic> json) {
    return AssistItem(
      text: json['text'] ?? '',
      smartQuestions: (json['smartQuestions'] as List?)
          ?.map((q) => SmartQuestion.fromJson(q))
          .toList() ?? [],
      // ... другие поля
    );
  }
}
```

## UX Рекомендации

### ✅ DO (Делайте так):

1. **Показывайте прогресс**: "2 из 3 вопросов отвечены"
2. **Визуальная обратная связь**: галочка при заполнении
3. **Объясняйте ценность**: показывайте `why` под каждым вопросом
4. **Не блокируйте**: пользователь может пропустить вопросы
5. **Поощряйте**: "✨ Отлично! Теперь шансы на матч выше 75%!"

### ❌ DON'T (Не делайте так):

1. Не делайте вопросы обязательными
2. Не перегружайте UI — показывайте 2-4 вопроса максимум
3. Не дублируйте вопросы с уже заполненными полями
4. Не показывайте технические названия полей (`field`)
5. Не игнорируйте `why` — это ключ к пониманию ценности

## Примеры реализации

### Вариант 1: Inline вопросы

```dart
Column(
  children: [
    TextField(/* основное поле ввода */),
    if (smartQuestions.isNotEmpty) ...[
      Divider(),
      Text('💡 Поможем найти лучшее совпадение'),
      ...smartQuestions.map((q) => QuestionTile(q)),
    ],
    ElevatedButton(/* публиковать */),
  ],
)
```

### Вариант 2: Expansion panel

```dart
ExpansionPanelList(
  expansionCallback: (index, isExpanded) => ...,
  children: [
    ExpansionPanel(
      headerBuilder: (context, isExpanded) => Text('💡 Умные вопросы'),
      body: Column(
        children: smartQuestions.map((q) => QuestionTile(q)).toList(),
      ),
    ),
  ],
)
```

### Вариант 3: Bottom sheet

```dart
showModalBottomSheet(
  context: context,
  builder: (context) => SmartQuestionsSheet(
    questions: smartQuestions,
    onComplete: (answers) => _enrichIntent(answers),
  ),
);
```

## Обратная совместимость

Если `smartQuestions` пусто — используйте старые поля:

```dart
Widget buildAssist(AssistItem item) {
  if (item.smartQuestions.isNotEmpty) {
    return SmartQuestionsWidget(questions: item.smartQuestions);
  } else {
    // Fallback на старый UI
    return MissingFieldsWidget(
      missingLabels: item.missingFieldsLabels,
      recommendedLabels: item.recommendedFieldsLabels,
    );
  }
}
```

## Тестирование

Используйте эти интенты для тестирования:

```dart
// Market
'продам ноутбук'
'куплю iPhone'

// Service  
'нужна помощь с покупками'
'предлагаю уборку квартир'

// Learning
'хочу учить английский'
'могу преподавать гитару'

// Rideshare
'еду Алматы-Астана завтра'
'ищу попутчика в аэропорт'
```

## FAQ

**Q: Обязательно ли отвечать на вопросы?**  
A: Нет, вопросы помогают, но не блокируют публикацию.

**Q: Сколько вопросов может быть?**  
A: Обычно 2-4, отсортированные по важности.

**Q: Что если пользователь не хочет отвечать?**  
A: Интент публикуется как есть. Вопросы — это помощь, а не требование.

**Q: Как вопросы влияют на матчинг?**  
A: Детальные интенты естественно достигают 75%+ similarity с похожими интентами.

**Q: Можно ли кастомизировать вопросы?**  
A: Пока нет, но планируется персонализация на основе истории пользователя.

## Поддержка

Полная документация: `SMART_ASSISTANT_API.md`

---

**Создавайте магию вместе с пользователями! 🪄✨**
