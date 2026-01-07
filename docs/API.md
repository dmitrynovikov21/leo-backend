# Leo Platform — API Documentation

---

## Сервис 1: leo-gateway (порт 8080)

Единая точка доступа к LLM и работа с документами.

---

### POST `/api/v1/chat/completions`

**Зачем:** Отправка запроса к LLM (Claude/GPT) с автоматическим трекингом токенов.

**Запрос:**
```json
{
  "userId": "user_abc123",
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    {"role": "system", "content": "Ты полезный ассистент"},
    {"role": "user", "content": "Что такое Docker?"}
  ],
  "temperature": 0.7,
  "max_tokens": 1024
}
```

**Ответ:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1703123456,
  "model": "claude-3-5-sonnet-20241022",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Docker — это платформа для контейнеризации приложений..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

---

### POST `/api/v1/generate-agent-prompt`

**Зачем:** Генерация system prompt для агента на основе имени, роли и описания (использует Claude).

**Запрос:**
```json
{
  "agentName": "Помощник по продажам",
  "role": "Консультант интернет-магазина",
  "description": "Помогает клиентам выбрать товар, отвечает на вопросы о доставке и оплате"
}
```

**Ответ:**
```json
{
  "agentName": "Помощник по продажам",
  "role": "Консультант интернет-магазина",
  "description": "Помогает клиентам выбрать товар...",
  "systemPrompt": "Ты — Помощник по продажам, дружелюбный консультант интернет-магазина.\n\n## Твоя роль\nТы помогаешь клиентам выбрать подходящий товар...\n\n## Стиль общения\n- Вежливый и профессиональный\n- Используй эмодзи уместно\n..."
}
```

---

### GET `/api/v1/usage/:userId`

**Зачем:** Получение статистики использования токенов пользователем.

**Запрос:**
```
GET /api/v1/usage/user_abc123
```

**Ответ:**
```json
{
  "userId": "user_abc123",
  "totalPromptTokens": 15420,
  "totalCompletionTokens": 28350,
  "totalTokens": 43770,
  "requestCount": 127
}
```

---

### POST `/api/v1/documents/parse` ⭐ NEW

**Зачем:** Парсинг документа в текст и разбиение на чанки (БЕЗ векторизации). Первый этап 2-step процесса.

**Запрос:**
```bash
curl -X POST http://localhost:8080/api/v1/documents/parse \
  -F "file=@document.docx" \
  -F "chunkSize=1000" \
  -F "chunkOverlap=200"
```

**Ответ:**
```json
{
  "success": true,
  "filename": "document.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "fileSize": 24567,
  "totalChunks": 15,
  "chunkSize": 1000,
  "chunkOverlap": 200,
  "chunks": [
    {
      "index": 0,
      "text": "Глава 1. Введение\n\nЭто руководство описывает основные принципы работы...",
      "startChar": 0,
      "endChar": 987
    },
    {
      "index": 1,
      "text": "...основные принципы работы с системой.\n\n1.1 Начало работы\nДля начала необходимо...",
      "startChar": 787,
      "endChar": 1756
    }
  ]
}
```

---

### POST `/api/v1/documents/parse-semantic` ⭐ NEW

**Зачем:** Семантическое разбиение документа с помощью LLM. Разбивает по смыслу, не по символам.

**Запрос:**
```bash
curl -X POST http://localhost:8080/api/v1/documents/parse-semantic \
  -F "file=@document.docx"
```

**Ответ:**
```json
{
  "success": true,
  "filename": "document.docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "fileSize": 24567,
  "totalChunks": 8,
  "method": "semantic-llm",
  "chunks": [
    {
      "index": 0,
      "title": "Определения и термины",
      "text": "ОКС – здание, строение, сооружение, объект..."
    },
    {
      "index": 1,
      "title": "Инженерная цифровая модель местности",
      "text": "ИЦММ – совокупность взаимосвязанных данных..."
    },
    {
      "index": 2,
      "title": "Типы данных в ЦИМ",
      "text": "Атрибутивные данные – существенные свойства...\nГеометрические данные – данные, определяющие размеры..."
    }
  ]
}
```

---

### POST `/api/v1/documents/vectorize` ⭐ NEW

**Зачем:** Векторизация чанков и сохранение в ChromaDB. Второй этап 2-step процесса.

**Запрос:**
```json
{
  "agentId": "agent_xyz789",
  "userId": "user_abc123",
  "filename": "document.docx",
  "chunks": [
    {"index": 0, "text": "Глава 1. Введение\n\nЭто руководство..."},
    {"index": 1, "text": "...основные принципы работы с системой..."},
    {"index": 2, "text": "1.2 Настройка\nДля настройки необходимо..."}
  ]
}
```

**Ответ:**
```json
{
  "success": true,
  "agentId": "agent_xyz789",
  "filename": "document.docx",
  "chunksVectorized": 3
}
```

---

### POST `/api/v1/documents/upload` (Legacy)

**Зачем:** Загрузка документа (docx, xlsx, pdf, txt) с автоматическим парсингом и векторизацией в одно действие.

**Запрос:**
```bash
curl -X POST http://localhost:8080/api/v1/documents/upload \
  -F "file=@training_materials.docx" \
  -F "agentId=agent_xyz789" \
  -F "userId=user_abc123"
```

**Ответ:**
```json
{
  "success": true,
  "filename": "training_materials.docx",
  "chunksCount": 42,
  "agentId": "agent_xyz789"
}
```

---

### POST `/api/v1/documents/upload-text`

**Зачем:** Загрузка текста напрямую (без файла) в knowledge base агента.

**Запрос:**
```json
{
  "agentId": "agent_xyz789",
  "userId": "user_abc123",
  "content": "# FAQ\n\n## Как оформить возврат?\nДля оформления возврата...\n\n## Сколько стоит доставка?\nДоставка бесплатная при заказе от 3000₽...",
  "filename": "faq.txt"
}
```

**Ответ:**
```json
{
  "success": true,
  "filename": "faq.txt",
  "chunksCount": 5,
  "agentId": "agent_xyz789"
}
```

---

### POST `/api/v1/documents/search`

**Зачем:** Поиск релевантных документов в knowledge base агента (RAG).

**Запрос:**
```json
{
  "agentId": "agent_xyz789",
  "query": "как оформить возврат товара",
  "limit": 3
}
```

**Ответ:**
```json
{
  "agentId": "agent_xyz789",
  "query": "как оформить возврат товара",
  "results": [
    {
      "content": "## Как оформить возврат?\nДля оформления возврата свяжитесь с поддержкой в течение 14 дней...",
      "metadata": {
        "source": "faq.txt",
        "chunkIndex": 2,
        "mimeType": "text/plain"
      },
      "score": 0.89
    },
    {
      "content": "Возврат денежных средств осуществляется в течение 3-5 рабочих дней...",
      "metadata": {
        "source": "policy.docx",
        "chunkIndex": 5,
        "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      "score": 0.76
    }
  ]
}
```

---

### GET `/api/v1/documents/:agentId/info`

**Зачем:** Информация о knowledge base агента.

**Запрос:**
```
GET /api/v1/documents/agent_xyz789/info
```

**Ответ:**
```json
{
  "agentId": "agent_xyz789",
  "vectorCount": 156,
  "documents": [
    {
      "id": "kb_123",
      "filename": "training_materials.docx",
      "file_size": 245678,
      "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "kb_124",
      "filename": "faq.txt",
      "file_size": 4521,
      "mime_type": "text/plain",
      "created_at": "2024-01-16T14:20:00Z"
    }
  ]
}
```

---

### DELETE `/api/v1/documents/:agentId`

**Зачем:** Удаление всей knowledge base агента.

**Запрос:**
```
DELETE /api/v1/documents/agent_xyz789
```

**Ответ:**
```json
{
  "success": true,
  "message": "Knowledge base for agent agent_xyz789 deleted"
}
```

---

---

## Сервис 2: agent-orchestrator (порт 8081)

Управление агентами и их Docker-контейнерами.

---

### GET `/api/v1/agents?userId={id}`

**Зачем:** Получение списка всех агентов пользователя.

**Запрос:**
```
GET /api/v1/agents?userId=user_abc123
```

**Ответ:**
```json
[
  {
    "id": "agent_xyz789",
    "user_id": "user_abc123",
    "name": "Support Bot",
    "role": "Консультант",
    "description": "Отвечает на вопросы клиентов",
    "system_prompt": "Ты дружелюбный консультант...",
    "telegram_token": "123456:ABC...",
    "status": "RUNNING",
    "container_id": "a1b2c3d4e5f6...",
    "container_name": "leo-agent-agent_xyz789",
    "created_at": "2024-01-10T08:00:00Z",
    "updated_at": "2024-01-15T12:30:00Z"
  },
  {
    "id": "agent_abc456",
    "user_id": "user_abc123",
    "name": "Sales Bot",
    "role": "Продавец",
    "description": "Помогает с выбором товаров",
    "status": "STOPPED",
    "container_id": null,
    "created_at": "2024-01-12T10:00:00Z",
    "updated_at": "2024-01-12T10:00:00Z"
  }
]
```

---

### POST `/api/v1/agents`

**Зачем:** Создание нового агента.

**Запрос:**
```json
{
  "userId": "user_abc123",
  "name": "Support Bot",
  "role": "Консультант поддержки",
  "description": "Отвечает на вопросы клиентов 24/7",
  "systemPrompt": "Ты — Support Bot, дружелюбный консультант.\n\nТвои задачи:\n- Отвечать на вопросы\n- Помогать с проблемами\n- Направлять к специалистам при необходимости",
  "telegramToken": "7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

**Ответ:**
```json
{
  "id": "clxyz123abc456",
  "user_id": "user_abc123",
  "name": "Support Bot",
  "role": "Консультант поддержки",
  "description": "Отвечает на вопросы клиентов 24/7",
  "system_prompt": "Ты — Support Bot, дружелюбный консультант...",
  "telegram_token": "7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "STOPPED",
  "container_id": null,
  "container_name": null,
  "created_at": "2024-01-20T15:00:00Z",
  "updated_at": "2024-01-20T15:00:00Z"
}
```

---

### GET `/api/v1/agents/:id`

**Зачем:** Получение информации об агенте.

**Запрос:**
```
GET /api/v1/agents/agent_xyz789
```

**Ответ:**
```json
{
  "id": "agent_xyz789",
  "user_id": "user_abc123",
  "name": "Support Bot",
  "role": "Консультант",
  "description": "Отвечает на вопросы клиентов",
  "system_prompt": "Ты дружелюбный консультант...",
  "telegram_token": "123456:ABC...",
  "status": "RUNNING",
  "container_id": "a1b2c3d4e5f6...",
  "container_name": "leo-agent-agent_xyz789",
  "created_at": "2024-01-10T08:00:00Z",
  "updated_at": "2024-01-15T12:30:00Z"
}
```

---

### PUT `/api/v1/agents/:id`

**Зачем:** Обновление агента (имя, роль, промпт, токен).

**Запрос:**
```json
{
  "name": "Support Bot Pro",
  "systemPrompt": "Ты — Support Bot Pro, продвинутый консультант с расширенными возможностями..."
}
```

**Ответ:**
```json
{
  "id": "agent_xyz789",
  "user_id": "user_abc123",
  "name": "Support Bot Pro",
  "role": "Консультант",
  "description": "Отвечает на вопросы клиентов",
  "system_prompt": "Ты — Support Bot Pro, продвинутый консультант...",
  "status": "RUNNING",
  "updated_at": "2024-01-20T16:00:00Z"
}
```

---

### DELETE `/api/v1/agents/:id`

**Зачем:** Удаление агента (также останавливает и удаляет контейнер).

**Запрос:**
```
DELETE /api/v1/agents/agent_xyz789
```

**Ответ:**
```
204 No Content
```

---

### POST `/api/v1/agents/:id/start`

**Зачем:** Запуск Docker-контейнера с  ботом.

**Запрос:**
```
POST /api/v1/agents/agent_xyz789/start
```

**Ответ:**
```json
{
  "id": "agent_xyz789",
  "name": "Support Bot",
  "status": "RUNNING",
  "container_id": "a1b2c3d4e5f6g7h8i9j0...",
  "container_name": "leo-agent-agent_xyz789",
  "updated_at": "2024-01-20T16:05:00Z"
}
```

---

### POST `/api/v1/agents/:id/stop`

**Зачем:** Остановка Docker-контейнера бота.

**Запрос:**
```
POST /api/v1/agents/agent_xyz789/stop
```

**Ответ:**
```json
{
  "id": "agent_xyz789",
  "name": "Support Bot",
  "status": "STOPPED",
  "container_id": "a1b2c3d4e5f6g7h8i9j0...",
  "container_name": "leo-agent-agent_xyz789",
  "updated_at": "2024-01-20T16:10:00Z"
}
```

---

### GET `/api/v1/agents/:id/status`

**Зачем:** Получение детального статуса агента и его контейнера.

**Запрос:**
```
GET /api/v1/agents/agent_xyz789/status
```

**Ответ:**
```json
{
  "agent": {
    "id": "agent_xyz789",
    "name": "Support Bot",
    "status": "RUNNING",
    "container_id": "a1b2c3d4e5f6g7h8i9j0...",
    "container_name": "leo-agent-agent_xyz789"
  },
  "container": {
    "containerId": "a1b2c3d4e5f6g7h8i9j0...",
    "containerName": "leo-agent-agent_xyz789",
    "status": "running"
  }
}
```

---

### GET `/api/v1/agents/:id/behavior`

**Зачем:** Получение настроек поведения агента (отдельно от system prompt).

**Запрос:**
```
GET /api/v1/agents/agent_xyz789/behavior
```

**Ответ:**
```json
{
  "avatarEmoji": "😊",
  "displayName": "Alex Support",
  "temperature": 0.5,
  "tone": ["friendly", "concise"],
  "guardrails": [
    { "id": "c123abc456", "rule": "Никогда не обещай функции, которых нет" }
  ]
}
```

---

### PATCH `/api/v1/agents/:id/behavior`

**Зачем:** Обновление настроек поведения агента.

**Запрос:**
```json
{
  "displayName": "New Name",
  "avatarEmoji": "🤖",
  "temperature": 0.7,
  "tone": ["professional"],
  "guardrails": [{ "rule": "Новое правило" }]
}
```

**Ответ:**
```json
{
  "avatarEmoji": "🤖",
  "displayName": "New Name",
  "temperature": 0.7,
  "tone": ["professional"],
  "guardrails": [
    { "id": "c456def789", "rule": "Новое правило" }
  ]
}
```

> **Примечание:** ID для guardrails генерируются автоматически.

---

### GET `/api/v1/agents/:id/prompts`

**Зачем:** Получение списка версий системной инструкции с историей.

**Запрос:**
```
GET /api/v1/agents/agent_xyz789/prompts
```

**Ответ:**
```json
{
  "versions": [
    { "id": "v123", "version": "v1.2", "isActive": true, "createdAt": "2024-12-27T10:00:00Z" },
    { "id": "v122", "version": "v1.1", "isActive": false, "createdAt": "2024-12-26T10:00:00Z" }
  ],
  "activePrompt": {
    "id": "v123",
    "content": "Ты — Alex Support, дружелюбный помощник..."
  }
}
```

---

### POST `/api/v1/agents/:id/prompts`

**Зачем:** Создание новой версии системной инструкции (автоматически становится активной).

**Запрос:**
```json
{
  "version": "v1.3",
  "content": "Ты — улучшенный помощник с новыми возможностями..."
}
```

**Ответ:**
```json
{
  "id": "v124",
  "version": "v1.3",
  "content": "Ты — улучшенный помощник с новыми возможностями...",
  "isActive": true,
  "createdAt": "2024-12-27T15:00:00Z"
}
```

---

### PATCH `/api/v1/agents/:id/prompts/:versionId/activate`

**Зачем:** Активация определённой версии системной инструкции (откат на предыдущую).

**Запрос:**
```
PATCH /api/v1/agents/agent_xyz789/prompts/v122/activate
```

**Ответ:**
```json
{
  "id": "v122",
  "version": "v1.1",
  "content": "Ты — Alex Support...",
  "isActive": true,
  "createdAt": "2024-12-26T10:00:00Z"
}
```

---

---

### GET `/api/v1/agents/:id/stats`

**Зачем:** Получение общей статистики по конкретному агенту.

**Запрос:**
```
GET /api/v1/agents/agent_xyz789/stats
```

**Ответ:**
```json
{
  "totalDialogs": 150,
  "todayDialogs": 12,
  "totalTokens": 25000,
  "avgResponseTimeMs": 2300
}
```

---

### GET `/api/v1/agents/:id/stats/period`

**Зачем:** Получение статистики по агенту за определенный период с разбивкой по дням.

**Запрос:**
```
GET /api/v1/agents/agent_xyz789/stats/period?from=2024-01-01T00:00:00Z&to=2024-01-07T00:00:00Z
```

**Ответ:**
```json
[
  { "date": "2024-01-01", "tokens": 1200, "dialogs": 5 },
  { "date": "2024-01-02", "tokens": 0, "dialogs": 0 },
  { "date": "2024-01-03", "tokens": 3000, "dialogs": 15 }
]
```

---

### GET `/api/v1/agents/stats/overview`

**Зачем:** Получение общей статистики пользователя по всем его агентам.
**Заголовок:** `x-user-id` — ID пользователя (обязательно).

**Запрос:**
```bash
curl -H "x-user-id: user_abc123" http://localhost:8081/api/v1/agents/stats/overview
```

**Ответ:**
```json
{
  "totalDialogs": 50,
  "totalMessages": 500,
  "totalUsers": 45,
  "totalTokens": 100500
}
```

---

### GET `/api/v1/agents/stats/history`

**Зачем:** Получение исторических данных (графиков) по всем агентам пользователя за 24 ч, 7 дней и 30 дней.
**Заголовок:** `x-user-id` — ID пользователя (обязательно).
**Интервалы:**
- `last24h`: каждый час
- `last7d`: каждый день
- `last30d`: каждые 3 дня

**Запрос:**
```bash
curl -H "x-user-id: user_abc123" http://localhost:8081/api/v1/agents/stats/history
```

**Ответ:**
```json
{
  "last24h": [
    { "date": "2024-01-20T10:00:00.000Z", "tokens": 120, "dialogs": 2 },
    { "date": "2024-01-20T11:00:00.000Z", "tokens": 500, "dialogs": 5 }
  ],
  "last7d": [
    { "date": "2024-01-14", "tokens": 5000, "dialogs": 20 },
    { "date": "2024-01-15", "tokens": 6000, "dialogs": 25 }
  ],
  "last30d": [
    { "date": "2023-12-21", "tokens": 15000, "dialogs": 50 },
    { "date": "2023-12-24", "tokens": 18000, "dialogs": 55 }
  ]
}
```

---

### GET `/api/v1/agents/:id/schedule`

**Зачем:** Получение графика работы агента (недельное расписание, праздники, сообщение в нерабочее время).

**Запрос:**
```
GET /api/v1/agents/agent_xyz789/schedule
```

**Ответ:**
```json
{
  "schedule": [
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
  ],
  "holidays": ["04.09.2025", "11.09.2025"],
  "message": "Здравствуйте! Сейчас я не на связи. Я отвечу вам в рабочее время."
}
```

> **Формат:** `schedule` — массив из 7 дней (0=пн, 6=вс), каждый содержит 24 boolean (часы 0-23). `holidays` — даты в формате DD.MM.YYYY.

---

### PUT `/api/v1/agents/:id/schedule`

**Зачем:** Сохранение графика работы агента.

**Запрос:**
```json
{
  "schedule": [
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
  ],
  "message": "Здравствуйте! Сейчас я не на связи. Я отвечу вам в рабочее время.",
  "holidays": ["04.09.2025", "11.09.2025"]
}
```

**Ответ:** Аналогичен GET — возвращает сохранённые данные.

---

## Статусы агентов

| Статус | Описание |
|--------|----------|
| `STOPPED` | Контейнер остановлен или не создан |
| `STARTING` | Контейнер запускается |
| `RUNNING` | Бот работает |
| `ERROR` | Ошибка контейнера |

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 400 | Validation error — неверный формат запроса |
| 404 | Not found — агент/документ не найден |
| 500 | Internal error — ошибка сервера |
| 503 | Service unavailable — БД или внешний сервис недоступен |
