# Worker Phase 1: Пошаговое руководство

## Текущий статус (God-Mode)

✅ **Режим бога активен**: все функции доступны всем пользователям  
✅ Ассистент работает (OpenAI gpt-4o-mini)  
✅ Переводы через Google Cloud Translate  
✅ Embeddings через Vertex AI (768-мерные векторы)  
✅ Семантический матчинг (similarity >= 0.75)  
✅ Push-уведомления на новые матчи  

⚠️ **Напоминание**: После Phase 1 будет введён тарифный план Lite/Pro

---

## Шаг 1: God-Mode флаги + лимиты активных интентов

### 1.1. Добавить переменные окружения

**На сервере:**
```bash
ssh root@45.136.57.119
nano /opt/magic-worker/.env
```

Добавить/обновить:
```bash
# God-Mode Phase 1
APP_MODE=god
ASSIST_FORCE_ENABLED=true

# Лимиты для защиты от перегрузки
MAX_ACTIVE_INTENTS_PER_USER=10
INTENT_PUBLISH_COOLDOWN_SEC=60
```

### 1.2. Реализовать проверку лимитов в index.js

**Добавить в начало файла (после констант):**
```javascript
// --- God-Mode & Limits ---
const APP_MODE = process.env.APP_MODE || 'production';
const MAX_ACTIVE_INTENTS = parseInt(process.env.MAX_ACTIVE_INTENTS_PER_USER || '10', 10);
const INTENT_COOLDOWN_MS = parseInt(process.env.INTENT_PUBLISH_COOLDOWN_SEC || '60', 10) * 1000;

// Cooldown tracking (в памяти, сбрасывается при рестарте)
const _intentPublishCooldowns = new Map();

function checkIntentCooldown(uid) {
  const last = _intentPublishCooldowns.get(uid);
  if (!last) return true;
  const elapsed = Date.now() - last;
  return elapsed >= INTENT_COOLDOWN_MS;
}

function setIntentCooldown(uid) {
  _intentPublishCooldowns.set(uid, Date.now());
}
```

**Обновить endpoint `/api/wish` (примерно строка 1177):**
```javascript
app.post('/api/wish', async (req, res) => {
  try {
    const { text, userId, userName = 'Magic User' } = req.body || {};
    const uid = userId || 'test_user';

    // Проверка cooldown
    if (!checkIntentCooldown(uid)) {
      const remaining = Math.ceil((INTENT_COOLDOWN_MS - (Date.now() - _intentPublishCooldowns.get(uid))) / 1000);
      return res.status(429).json({ 
        success: false, 
        error: 'cooldown_active',
        message: `Please wait ${remaining} seconds before publishing another intent`,
        remainingSeconds: remaining
      });
    }

    // Проверка лимита активных интентов
    if (firebaseLoaded && db) {
      const activeSnap = await db.collection('intents')
        .where('userId', '==', uid)
        .where('status', '==', 'published')
        .get();
      
      if (activeSnap.size >= MAX_ACTIVE_INTENTS) {
        return res.status(429).json({
          success: false,
          error: 'too_many_intents',
          message: `You have reached the limit of ${MAX_ACTIVE_INTENTS} active intents. Please complete or archive some first.`,
          activeCount: activeSnap.size,
          maxAllowed: MAX_ACTIVE_INTENTS
        });
      }
    }

    const id = `test_${Date.now()}`;

    if (!firebaseLoaded || !db) {
      return res.json({ success: true, message: 'received (mock mode — no Firebase)', intentId: id, mode: 'mock' });
    }

    const data = {
      text: text || '',
      userId: uid,
      userName,
      type: 'want',
      status: 'published',
      createdAt: new Date(),
    };

    await db.collection('intents').doc(id).set(data);
    setIntentCooldown(uid);
    
    return res.json({ 
      success: true, 
      message: 'INTENT created; listener will process it', 
      intentId: id, 
      mode: 'firebase_intents',
      godMode: APP_MODE === 'god'
    });
  } catch (e) {
    console.error('/api/wish error:', e);
    res.status(500).json({ success: false, error: String(e.message || e) });
  }
});
```

### 1.3. Применить изменения

```bash
pm2 restart magic-worker
pm2 logs magic-worker --lines 50
```

### 1.4. Тестирование

```bash
# Тест успешной публикации
curl -sS -X POST http://localhost:3000/api/wish \
  -H "Content-Type: application/json" \
  -d '{"text":"I want to learn Python","userId":"test_limits_1"}' | jq .

# Быстрая повторная попытка (должна вернуть 429 cooldown)
curl -sS -X POST http://localhost:3000/api/wish \
  -H "Content-Type: application/json" \
  -d '{"text":"I want to learn Java","userId":"test_limits_1"}' | jq .

# Через 60 сек повтори — должно сработать
```

---

## Шаг 2: Endpoint для получения статистики пользователя

### 2.1. Добавить `/api/user/stats`

**В index.js (после других эндпоинтов):**
```javascript
// Статистика пользователя (для UI индикаторов)
app.get('/api/user/stats', async (req, res) => {
  try {
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ ok: false, error: 'uid_required' });

    if (!firebaseLoaded || !db) {
      return res.json({ ok: true, activeIntents: 0, maxIntents: MAX_ACTIVE_INTENTS, godMode: true });
    }

    const activeSnap = await db.collection('intents')
      .where('userId', '==', uid)
      .where('status', '==', 'published')
      .get();

    const lastPublish = _intentPublishCooldowns.get(uid);
    const cooldownRemaining = lastPublish 
      ? Math.max(0, Math.ceil((INTENT_COOLDOWN_MS - (Date.now() - lastPublish)) / 1000))
      : 0;

    return res.json({
      ok: true,
      activeIntents: activeSnap.size,
      maxIntents: MAX_ACTIVE_INTENTS,
      cooldownRemaining,
      godMode: APP_MODE === 'god',
      limits: {
        intents: `${activeSnap.size}/${MAX_ACTIVE_INTENTS}`,
        nextPublishIn: cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'available'
      }
    });
  } catch (e) {
    console.error('/api/user/stats error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
```

### 2.2. Тестирование

```bash
curl -sS "http://localhost:3000/api/user/stats?uid=test_limits_1" | jq .
```

Ожидаемый ответ:
```json
{
  "ok": true,
  "activeIntents": 1,
  "maxIntents": 10,
  "cooldownRemaining": 45,
  "godMode": true,
  "limits": {
    "intents": "1/10",
    "nextPublishIn": "45s"
  }
}
```

---

## Шаг 3: Улучшенный перевод матчей (endpoint для deliver)

### 3.1. Добавить `/api/match/translate`

**В index.js:**
```javascript
// Перевод текста матча на целевой язык
app.post('/api/match/translate', async (req, res) => {
  try {
    const { matchId, targetLang = 'en', field = 'bText' } = req.body || {};
    
    if (!matchId) return res.status(400).json({ ok: false, error: 'matchId_required' });
    if (!firebaseLoaded || !db) return res.status(503).json({ ok: false, error: 'firebase_unavailable' });

    const mRef = db.collection('matches').doc(matchId);
    const mSnap = await mRef.get();
    
    if (!mSnap.exists) return res.status(404).json({ ok: false, error: 'match_not_found' });

    const match = mSnap.data() || {};
    const textToTranslate = match[field] || '';
    
    if (!textToTranslate) {
      return res.status(400).json({ ok: false, error: 'text_empty' });
    }

    // Проверить кэш
    const cachedPath = `translations.${field}.${targetLang}`;
    const cached = match.translations?.[field]?.[targetLang];
    
    if (cached) {
      return res.json({ ok: true, translated: cached, cached: true, targetLang });
    }

    // Перевести
    const translated = await translators.translate(textToTranslate, targetLang);
    
    // Сохранить в кэш
    await mRef.set({
      translations: {
        [field]: {
          [targetLang]: translated
        }
      },
      updatedAt: FV.serverTimestamp()
    }, { merge: true });

    return res.json({ ok: true, translated, cached: false, targetLang });
  } catch (e) {
    console.error('/api/match/translate error:', e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
```

### 3.2. Тестирование

```bash
# Создай тестовый матч (или используй существующий)
MATCH_ID="<existing_match_id>"

curl -sS -X POST http://localhost:3000/api/match/translate \
  -H "Content-Type: application/json" \
  -d "{\"matchId\":\"$MATCH_ID\",\"targetLang\":\"ru\",\"field\":\"bText\"}" | jq .
```

---

## Шаг 4: Ассистент с фасетами (семантическими тегами)

### 4.1. Обновить промпт в `_openaiAssistContinue`

**Найти функцию (примерно строка 233) и обновить:**
```javascript
async function _openaiAssistContinue({ text, lang }) {
  if (!OPENAI_API_KEY) return null;

  const body = {
    model: ASSIST_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an AI assistant for MagicAIbox, a platform where people share wishes and offers. ' +
          'Given a user wish/offer, suggest 3-5 improved variations. ' +
          'Each suggestion must include: (1) refined text (<=200 chars), (2) semantic facets/tags (e.g., "learning", "teaching", "exchange", "music", "travel"). ' +
          'Output MUST be valid JSON: {"suggestions":[{"text":"...","facets":["...","..."]},...]}. ' +
          'Language must match input. No markdown, no extra text.',
      },
      {
        role: 'user',
        content: `Language: ${lang || 'auto'}\nUser wish:\n"${text}"\n\nProvide JSON with suggestions array.`,
      },
    ],
    max_tokens: ASSIST_MAX_TOKENS + 50, // больше для facets
    temperature: 0.7,
    n: 1,
    response_format: { type: 'json_object' },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ASSIST_TIMEOUT_MS);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`OpenAI ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '{"suggestions":[]}';
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Fallback: попытка извлечь JSON из текста
      const m = content.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { suggestions: [] };
    }
    
    const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    
    // Нормализация: если пришёл массив строк, оборачиваем в объекты
    const normalized = suggestions.map(s => {
      if (typeof s === 'string') return { text: s, facets: [] };
      return { text: s.text || '', facets: Array.isArray(s.facets) ? s.facets : [] };
    });

    return normalized.filter(s => s.text.length >= 10);
  } finally {
    clearTimeout(t);
  }
}
```

### 4.2. Обновить обработчик ассиста

**В `_assistHandler` (строка 299):**
```javascript
async function _assistHandler(req, res) {
  const t0 = Date.now();
  try {
    if (!ASSIST_ENABLED) return res.status(503).json({ ok: false, error: 'assist_disabled' });

    const origin = req.headers.origin;
    if (ASSIST_ALLOW_ORIGINS.length && origin && !ASSIST_ALLOW_ORIGINS.includes(origin)) {
      return res.status(403).json({ ok: false, error: 'origin_forbidden' });
    }

    const { text = '', lang = 'auto', uid } = req.body || {};
    const cleaned = dehtml(text).trim();
    if (cleaned.length < 12) return res.status(400).json({ ok: false, error: 'text_too_short' });

    const key = uid ? `u:${uid}` : `ip:${req.ip}`;
    if (!_assistAllow(key, 8, 60_000)) return res.status(429).json({ ok: false, error: 'rate_limited' });

    if (!OPENAI_API_KEY) return res.status(503).json({ ok: false, error: 'no_ai_provider' });

    const cacheKey = _hash(`v3|${lang}|${cleaned}`);
    const cached = _cacheGet(cacheKey);
    if (cached) return res.json({ ok: true, items: cached, cached: true, ms: Date.now() - t0, godMode: APP_MODE === 'god' });

    const items = await _openaiAssistContinue({ text: cleaned, lang });
    if (!Array.isArray(items) || !items.length) return res.status(204).end();

    _cacheSet(cacheKey, items);
    console.log(`💡 [${req._rid}] assist ${items.length} in ${Date.now() - t0}ms`);
    return res.json({ ok: true, items, ms: Date.now() - t0, godMode: APP_MODE === 'god' });
  } catch (e) {
    const msg = e?.message || String(e);
    const isAbort = /aborted|AbortError|The operation was aborted/i.test(msg);
    return res.status(isAbort ? 504 : 500).json({ ok: false, error: msg, ms: Date.now() - t0 });
  }
}
```

### 4.3. Тестирование

```bash
curl -sS -X POST http://localhost:3000/api/assist/continue \
  -H "Content-Type: application/json" \
  -d '{"text":"I want to learn Spanish for travel","lang":"en","uid":"test_facets"}' | jq .
```

Ожидаемый ответ (новый формат):
```json
{
  "ok": true,
  "items": [
    {
      "text": "I want to learn Spanish to communicate with locals during my travels.",
      "facets": ["learning", "travel", "language"]
    },
    ...
  ],
  "ms": 2100,
  "godMode": true
}
```

---

## Шаг 5: Снизить порог similarity до 0.70 (опционально)

```bash
nano /opt/magic-worker/.env
```

Изменить:
```bash
EMBEDDINGS_MIN_SIM=0.70
```

Перезапустить:
```bash
pm2 restart magic-worker
```

---

## Шаг 6: ADC и удаление секретов из .env

### 6.1. Убедиться, что service-account.json на месте

```bash
ls -l /opt/magic-worker/service-account.json
# Должен быть файл с правами 600
```

### 6.2. Удалить приватные ключи из .env

```bash
nano /opt/magic-worker/.env
```

**Удалить строки:**
```bash
# Удалить полностью:
type=...
project_id=...
private_key_id=...
private_key="-----BEGIN..."
client_email=...
client_id=...
auth_uri=...
token_uri=...
auth_provider_x509_cert_url=...
client_x509_cert_url=...
universe_domain=...
```

**Оставить только:**
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
FIREBASE_PROJECT_ID=my-cool-magicbox
GOOGLE_CLOUD_PROJECT=my-cool-magicbox
GCP_PROJECT=my-cool-magicbox
```

### 6.3. Перезапустить и проверить

```bash
pm2 restart magic-worker
pm2 logs magic-worker --lines 30 | grep -E "Firebase|GCT|Vertex"
```

Должно быть:
- "Firebase initialized successfully"
- Нет ошибок "Invalid PEM"

---

## Шаг 7: Финальная проверка всех функций

```bash
# Health check
curl -s http://localhost:3000/health | jq .

# Ассистент с фасетами
curl -sS -X POST http://localhost:3000/api/assist/continue \
  -H "Content-Type: application/json" \
  -d '{"text":"I want to teach guitar online","lang":"en","uid":"final_test"}' | jq .

# Статистика пользователя
curl -s "http://localhost:3000/api/user/stats?uid=final_test" | jq .

# Создание интента
curl -sS -X POST http://localhost:3000/api/wish \
  -H "Content-Type: application/json" \
  -d '{"text":"I want to learn programming","userId":"final_test"}' | jq .

# Проверка матчей в Firestore Console
echo "Открой Firebase Console → Firestore → коллекция matches"
```

---

## Чек-лист готовности Worker Phase 1

- [x] God-mode включен (APP_MODE=god)
- [x] Лимит активных интентов работает (10 на пользователя)
- [x] Cooldown публикации работает (60 сек)
- [x] Endpoint `/api/user/stats` возвращает статистику
- [x] Endpoint `/api/match/translate` кэширует переводы
- [x] Ассистент возвращает фасеты (items: [{text, facets}])
- [x] service-account.json используется, приватные ключи удалены из .env
- [x] Similarity порог настроен (0.70 или 0.75)
- [x] Health check показывает godMode: true
- [x] PM2 автостарт настроен (pm2 startup + pm2 save)
- [x] Firewall открыт для порта 3000
- [x] Логи без критических ошибок

---

## Следующие шаги

После завершения Phase 1:
- Добавить алерты на 5xx/таймауты (Cloud Monitoring)
- Включить тарифный план Lite/Pro (Phase 2)
- Разделить HTTP и Firestore listeners (Cloud Functions)
- Добавить аналитику конверсии матчей
