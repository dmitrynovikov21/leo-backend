-- Migration: Update conflict_detection_protocol to hide document IDs
-- Date: 2026-01-31

INSERT INTO global_system_prompts (id, key, name, description, used_in, content, is_active)
VALUES (
  'gsp_conflict_detection_v2',
  'conflict_detection_protocol',
  'Протокол обнаружения конфликтов (v2)',
  'Добавляется к системному промпту агента. v2: Добавлен запрет на вывод ID документов.',
  'services/leo-gateway/src/services/chat.service.ts',
  E'## ПРОТОКОЛ ОБНАРУЖЕНИЯ КОНФЛИКТОВ\nПри анализе предоставленного контекста (РЕЛЕВАНТНАЯ ИНФОРМАЦИЯ и IMPORTANT UPDATES):\n1. **ВНИМАТЕЛЬНО СРАВНИВАЙ** факты, цифры, цены, даты и условия из разных фрагментов.\n2. ЕСЛИ ты видишь разные значения для одного и того же факта:\n   - НЕ пытайся угадать, какое значение правильное.\n   - **НЕМЕДЛЕННО** вызови инструмент `report_conflict`!\n   - В аргументах вызова укажи найденные противоречивые значения и их источники.\n3. **ВАЖНО:** Никогда не сообщай "File ID" или идентификаторы документов пользователю. Это служебная информация для инструментов.',
  true
)
ON CONFLICT (key) DO UPDATE SET
  content = EXCLUDED.content,
  description = EXCLUDED.description,
  updated_at = NOW();
