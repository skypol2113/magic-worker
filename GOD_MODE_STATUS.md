# God-Mode Status & Reminder

## Текущее состояние системы

**Дата фиксации:** 8 ноября 2025  
**Режим:** God Mode (все функции включены для всех пользователей)  
**Фаза:** Phase 1 - MVP подготовка к публикации

---

## ✨ Включенные функции (God Mode)

### Для всех пользователей доступны:

✅ **AI Assistant** (OpenAI gpt-4o-mini)
- 5 рекомендаций на каждый запрос
- Семантические теги (facets) для улучшенного контекста
- Кэширование ответов (60 сек TTL)
- Лимит: 8 запросов/минуту на пользователя

✅ **Automatic Translation** (Google Cloud Translate)
- Перевод интентов на 8 языков при создании
- Перевод текста собеседника в MatchDetail
- Кэширование переводов в Firestore
- Определение языка автоматически

✅ **Semantic Matching** (Vertex AI Embeddings)
- 768-мерные векторы для семантического поиска
- Порог совпадения: similarity >= 0.75 (или 0.70)
- Топ-3 наиболее релевантных матча
- Автоматический расчёт при публикации

✅ **Push Notifications**
- Уведомления о новых матчах в реальном времени
- FCM (Firebase Cloud Messaging)
- Поддержка 8 языков (локализация в планах)

✅ **Contact Workflow**
- Запросы на контакт между пользователями
- Обмен снэпшотами интентов
- Аудит событий (события в contact_requests_events)

---

## ⚠️ Временные лимиты (защита от перегрузки)

Во время God Mode действуют следующие ограничения:

| Лимит | Значение | Причина |
|-------|----------|---------|
| Активные интенты | 10 на пользователя | Защита от спама |
| Cooldown публикации | 60 секунд | Rate limiting |
| AI ассистент | 8 запросов/мин | OpenAI API лимиты |
| Timeout ассистента | 12 секунд | Быстрый response |

---

## 📊 План тарификации (после Phase 1)

### Lite Plan (Free)
- Создание интентов: ДА (10 активных)
- Просмотр матчей: ДА
- AI Assistant: НЕТ (или 3 запроса/день)
- Переводы: НЕТ (только оригинальный язык)
- Semantic matching: НЕТ (keyword-based)

### Pro Plan (платная подписка)
- Создание интентов: ДА (25 активных)
- Просмотр матчей: ДА
- AI Assistant: ДА (unlimited)
- Переводы: ДА (все языки)
- Semantic matching: ДА (Vertex AI)
- Priority support: ДА

**Цена:** TBD (примерно $3-5/месяц)

---

## 🔔 Напоминания для пользователей (UI)

### 1. Главный экран (Home)
```
┌─────────────────────────────────────────┐
│ ✨ God Mode Active                      │
│ All Pro features are free during       │
│ testing. Enjoy!                         │
└─────────────────────────────────────────┘
```

### 2. Экран создания интента (Create Intent)
```
┌─────────────────────────────────────────┐
│ ✨ God Mode Active: All Pro features   │
│ enabled for testing. Limits will apply  │
│ after launch.                           │
└─────────────────────────────────────────┘

Active Intents: 3/10

[Text input field...]

[Publish Intent]
```

### 3. MatchDetail с переводом
```
┌─────────────────────────────────────────┐
│ ✨ Translation is a Pro feature —      │
│ currently free in God Mode for all      │
│ users.                                  │
└─────────────────────────────────────────┘

[Translated text here...]

[ Show Original ]
```

### 4. AI Assistant
```
💡 AI Suggestions: (Pro feature, free in God Mode)

┌─────────────────────────────────────────┐
│ I want to teach guitar to beginners    │
│ Tags: teaching, music, education        │
└─────────────────────────────────────────┘
```

---

## 📝 Что изменится после Phase 1

### Отключение God Mode

После публикации в App Store/Google Play:

1. **APP_MODE=production** (вместо god)
2. Lite пользователи:
   - Ассистент отключен (или лимитирован)
   - Переводы отключены
   - Semantic matching → keyword matching
3. Pro пользователи (подписка):
   - Все функции как в God Mode
   - Возможность donate/upgrade

### Миграция существующих пользователей

Все пользователи, зарегистрированные до Phase 1:
- **1 месяц бесплатного Pro** (thank you for testing)
- После месяца — выбор Lite/Pro
- Данные сохраняются (интенты, матчи)

---

## 🚦 Чек-лист перед отключением God Mode

- [ ] Тарифные планы реализованы в Firebase (users.subscription)
- [ ] Donate интеграция работает (Boosty/Stripe)
- [ ] UI показывает статус подписки (Lite/Pro badge)
- [ ] Backend проверяет subscription перед AI/переводами
- [ ] Graceful degradation для Lite пользователей
- [ ] Email уведомления об истечении Trial
- [ ] Страница Pricing в приложении
- [ ] Analytics настроена (конверсия Free→Pro)
- [ ] Support контакты для вопросов по подписке

---

## 🔧 Переменные окружения (God Mode)

### Worker (.env на сервере)

```bash
# God Mode Phase 1
APP_MODE=god
ASSIST_FORCE_ENABLED=true

# Лимиты
MAX_ACTIVE_INTENTS_PER_USER=10
INTENT_PUBLISH_COOLDOWN_SEC=60

# AI & Embeddings
ASSIST_ENABLED=true
EMBEDDINGS_ENABLED=true
EMBEDDINGS_MIN_SIM=0.75

# Translation
TRANSLATOR_PROVIDER=gct

# OpenAI
OPENAI_API_KEY=sk-proj-...
ASSIST_MODEL=gpt-4o-mini
ASSIST_MAX_TOKENS=170
ASSIST_TIMEOUT_MS=12000

# GCP
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_PROJECT=my-cool-magicbox
```

### Flutter (.env или Firebase Remote Config)

```bash
# API endpoint
API_BASE_URL=http://45.136.57.119:3000

# God Mode flag (для UI баннеров)
GOD_MODE_ACTIVE=true

# Feature flags
SHOW_DONATE_BUTTON=true
SHOW_PRO_REMINDER=true
```

---

## 📞 Контакты и поддержка

- **Email:** support@magicaibox.com (TBD)
- **Telegram:** @magicaibox_support (TBD)
- **Discord:** discord.gg/magicaibox (TBD)

---

## 📅 Roadmap

- **Phase 1 (текущая):** God Mode + MVP функции
- **Phase 2:** Тарифные планы Lite/Pro + Donate
- **Phase 3:** Advanced matching + Analytics
- **Phase 4:** Social features + Referral program

---

**Фиксация:** Этот документ служит официальным подтверждением текущего статуса God Mode и плана перехода к тарифным планам после Phase 1.

**Версия:** 1.0  
**Автор:** Development Team  
**Дата:** 2025-11-08
