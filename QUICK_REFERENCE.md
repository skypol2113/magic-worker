# 🚀 Quick Reference - Magic Worker

## 📍 Расположение файлов

### Локальная машина
```
C:\prod\magic-worker\
```

### Production сервер (VM)
```
IP: 45.136.57.119
User: root
Path: /root/magic-worker/
PM2 Process: magic-worker
Port: 3000
```

### GitHub репозиторий
```
https://github.com/skypol2113/magic-worker
Owner: skypol2113
Branch: main
```

---

## 🔑 SSH подключение

```bash
# Подключение к серверу
ssh root@45.136.57.119

# Проверка статуса PM2
ssh root@45.136.57.119 "pm2 status"

# Логи в реальном времени
ssh root@45.136.57.119 "pm2 logs magic-worker --lines 50"

# Рестарт
ssh root@45.136.57.119 "cd /root/magic-worker && git pull && npm install && pm2 restart magic-worker"
```

---

## 🧪 Быстрая проверка работоспособности

### 1. Проверка health endpoint
```bash
curl http://45.136.57.119:3000/health
# Ожидается: {"status":"ok","timestamp":"..."}
```

### 2. Проверка перевода матча
```bash
ssh root@45.136.57.119 "curl -s -X POST http://127.0.0.1:3000/api/match/translate \
-H 'Content-Type: application/json' \
-d '{\"matchId\":\"LfimBoJq2yV7MADL4NPZ\",\"field\":\"aText\",\"targetLang\":\"ru\"}'"
```

### 3. Проверка перевода сообщения
```bash
ssh root@45.136.57.119 "curl -s -X POST http://127.0.0.1:3000/api/message/translate \
-H 'Content-Type: application/json' \
-d '{\"matchId\":\"LfimBoJq2yV7MADL4NPZ\",\"messageId\":\"ieHcYeOZrjEPsX9fL7ti\",\"targetLang\":\"en\"}'"
```

### 4. Проверка PM2 статуса
```bash
ssh root@45.136.57.119 "pm2 status"
# Должен показать: magic-worker | online | uptime
```

---

## 📦 Деплой изменений

### Из локальной машины
```bash
cd /c/prod/magic-worker

# 1. Коммит изменений
git add -A
git commit -m "feat: описание изменений"
git push origin main

# 2. Деплой на сервер
ssh root@45.136.57.119 "cd /root/magic-worker && git pull && npm install && pm2 restart magic-worker"

# 3. Проверка логов
ssh root@45.136.57.119 "pm2 logs magic-worker --lines 30"
```

### Прямо на сервере
```bash
ssh root@45.136.57.119
cd /root/magic-worker
git pull
npm install
pm2 restart magic-worker
pm2 logs magic-worker
```

---

## 🔍 Отладка

### Просмотр логов
```bash
# Последние 50 строк
ssh root@45.136.57.119 "pm2 logs magic-worker --lines 50"

# Только ошибки
ssh root@45.136.57.119 "pm2 logs magic-worker --err --lines 30"

# Логи в реальном времени
ssh root@45.136.57.119 "pm2 logs magic-worker"
```

### Проверка процессов
```bash
# Информация о процессе
ssh root@45.136.57.119 "pm2 show magic-worker"

# Мониторинг в реальном времени
ssh root@45.136.57.119 "pm2 monit"
```

### Firestore проверка (если нужно)
```bash
# Запуск REST API для Firestore
ssh root@45.136.57.119 "cd /root/magic-worker && node api/rest.js"
```

---

## 🔥 API Endpoints

### Production URLs
```
Base URL: http://45.136.57.119:3000

GET  /health                      # Health check
GET  /api/stats                   # System statistics
POST /api/match/translate         # Translate match fields
POST /api/message/translate       # Translate chat messages
```

### Тестовые данные
```
Match ID: LfimBoJq2yV7MADL4NPZ
Message IDs:
  - ieHcYeOZrjEPsX9fL7ti (EN: "Hello! I am interested...")
  - msg2_id (RU: "Привет! Да, он ещё доступен...")
  - msg3_id (JA: "こんにちは！まだ利用可能ですか？")
```

---

## 📚 Документация

### Для Flutter разработчиков
- `CHAT_TRANSLATION_API.md` - API спецификация для чата
- `CLIENT_INTEGRATION_GUIDE.md` - Гайд по интеграции
- `TRANSLATION_STRATEGY.md` - Light/Pro бизнес-модель
- `FLUTTER_PHASE1_STEPS.md` - Этапы интеграции

### Для backend
- `README.md` - Общее описание проекта (если есть)
- `GOD_MODE_STATUS.md` - Статус god mode фичи
- `WORKER_PHASE1_STEPS.md` - Этапы разработки worker

---

## 🛠️ Важные файлы

### Конфигурация
```
ecosystem.config.js          # PM2 конфигурация
package.json                 # Зависимости
.env                         # Секреты (НЕ в git!)
service-account.json         # Firebase credentials (НЕ в git!)
```

### Код
```
index.js                     # Главный файл приложения
worker/translators/          # Модули переводов
ml/                          # ML логика (semantic, classifier)
matcher/                     # Matching алгоритм
```

---

## ⚡ Горячие команды

```bash
# Быстрая проверка всего
alias check-worker='ssh root@45.136.57.119 "pm2 status && curl -s http://127.0.0.1:3000/health"'

# Быстрый деплой
alias deploy-worker='cd /c/prod/magic-worker && git push && ssh root@45.136.57.119 "cd /root/magic-worker && git pull && pm2 restart magic-worker"'

# Логи
alias worker-logs='ssh root@45.136.57.119 "pm2 logs magic-worker --lines 50"'
```

---

## 🆘 Если что-то сломалось

### 1. Worker не отвечает
```bash
ssh root@45.136.57.119 "pm2 restart magic-worker"
ssh root@45.136.57.119 "pm2 logs magic-worker --err"
```

### 2. Ошибки после деплоя
```bash
ssh root@45.136.57.119 "cd /root/magic-worker && npm ci && pm2 restart magic-worker"
```

### 3. Полный перезапуск
```bash
ssh root@45.136.57.119 "pm2 delete magic-worker && cd /root/magic-worker && pm2 start ecosystem.config.js"
```

### 4. Проверка портов
```bash
ssh root@45.136.57.119 "netstat -tulpn | grep 3000"
```

---

## ✅ Чеклист перед закрытием сессии

- [ ] PM2 статус `online`
- [ ] Health endpoint отвечает
- [ ] Translation API тестирован
- [ ] Логи без критических ошибок
- [ ] Последние изменения закоммичены в git
- [ ] GitHub Actions build успешен

---

**Последнее обновление:** 12 ноября 2025  
**Версия:** v1.0 (Chat translation ready)
