const RAG_TEST_MODES = Object.freeze([
  "baseline",
  "rewrite_only",
  "filter_only",
  "rewrite_and_filter",
]);

const TEST_QUESTIONS = Object.freeze([
  { id: "q1", question: "Какие self-hosted альтернативы Google Analytics перечислены в разделе Analytics?", expectedFocus: "Найти раздел Analytics и перечислить альтернативы Google Analytics." },
  { id: "q2", question: "Найди в разделе Analytics инструмент с лицензией EUPL-1.2 и скажи, на каком языке он написан.", expectedFocus: "Проверяем поиск по лицензии EUPL-1.2 и извлечение языка реализации." },
  { id: "q3", question: "Какие аналитические инструменты из списка написаны на Nodejs/Docker?", expectedFocus: "Нужно отфильтровать analytics-инструменты по тегу Nodejs/Docker." },
  { id: "q4", question: "Есть ли в документе self-hosted инструмент для локального запуска LLM-моделей и какие примеры таких инструментов перечислены?", expectedFocus: "Проверяем поиск по GenAI/LLM разделам и примерам локального запуска моделей." },
  { id: "q5", question: "Какие решения для CalDAV/CardDAV перечислены в разделе Calendar & Contacts?", expectedFocus: "Найти раздел Calendar & Contacts и вытащить решения для CalDAV/CardDAV." },
  { id: "q6", question: "Мне нужен self-hosted почтовый сервер в Docker с современным web UI. Какие варианты есть в разделе Communication - Email - Complete Solutions?", expectedFocus: "Ищем complete email solutions с Docker и современным web UI." },
  { id: "q7", question: "Какие решения в разделе Communication - Custom Communication Systems являются альтернативами Slack или Discord?", expectedFocus: "Проверяем, какие custom communication systems позиционируются как Slack/Discord alternatives." },
  { id: "q8", question: "Найди инструменты с пометкой ⚠ в разделе Automation.", expectedFocus: "Ищем warning-marked инструменты внутри Automation." },
  { id: "q9", question: "Какой инструмент в разделе Automation описан как “IFTTT for Ops” и что про него сказано?", expectedFocus: "Проверяем точный поиск по фразе IFTTT for Ops и извлечение описания." },
  { id: "q10", question: "Я хочу self-hosted bookmark manager на Docker, желательно минималистичный и быстрый. Какие варианты из раздела Bookmarks and Link Sharing подходят лучше всего?", expectedFocus: "Нужно найти подходящие bookmark managers по Docker и признакам minimal/fast." },
]);

const MARKDOWN_EXPORT_QUESTIONS = Object.freeze(TEST_QUESTIONS.slice(0, 5));

export { MARKDOWN_EXPORT_QUESTIONS, RAG_TEST_MODES, TEST_QUESTIONS };
