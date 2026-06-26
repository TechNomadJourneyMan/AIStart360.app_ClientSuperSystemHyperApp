# 06 — OSINT Pipeline & Entity Resolution

## Цель

Из разрозненных кусков (HTML регистра, отзыв в 2GIS, объявление о найме, телефон в посте Telegram) собрать **единую сущность** (компания/человек) с **верифицированными связями** и **источниками каждого факта**.

## Принцип: provenance everywhere

Каждое поле сущности должно отвечать на вопрос «откуда?». Поэтому:

```python
class FieldValue(BaseModel):
    value: Any
    source_page_id: UUID
    extracted_at: datetime
    extractor: str            # 'rule:goszakup_v2', 'llm:gemini-2.5-flash', 'manual'
    confidence: float         # 0..1
```

В таблице `companies` каждое seed-поле дублируется в `companies_field_provenance(company_id, field, source_page_id, value, confidence)`.

## Источники (CIS-фокус)

### Государственные регистры
- **kgd.gov.kz** (КГД РК — налоговый комитет)
- **stat.gov.kz** (статистика)
- **goszakup.kz** (госзакупки KZ)
- **adata.kz**, **kompra.kz** (агрегаторы KZ)
- **egrul.nalog.ru** (RU ЕГРЮЛ/ЕГРИП)
- **zakupki.gov.ru**, **rostender.info**
- **dpi.uz** (UZ статистика), **my.gov.uz**
- **register.kg** (KG)

### Бизнес-каталоги
- **2GIS** (KZ/RU/UZ) — карты, рейтинги, отзывы, телефоны
- **Yandex Карты** — аналог
- **OpenStreetMap** — адреса, тип POI

### СМИ и контент
- **forbes.kz**, **kursiv.media**, **kapital.kz**, **inbusiness.kz**
- **rbc.ru**, **kommersant.ru**, **vedomosti.ru**
- Telegram-каналы (через MTProto или t.me/s/)

### Тендеры/закупки
- goszakup.kz, zakupki.gov.ru, OFD-данные

### Социалки и сигналы
- LinkedIn (через прокси, очень аккуратно), HeadHunter (вакансии = рост)
- Instagram бизнес-аккаунты, TikTok
- VKontakte (RU), Threads, X

### Каталоги юристов и патентов
- court.gov.kz, sudact.ru — судебные дела
- WIPO, Kazpatent — патенты, ТМ

## Конвейер

```
┌────────────┐    ┌────────────┐    ┌───────────────────┐
│ Discovery  │──►│ Crawl      │──►│ Extraction Agent  │
└────────────┘   │ Agent      │   │  (rule + LLM)     │
                 └────────────┘   └────────┬──────────┘
                                            ▼
                                  ┌────────────────────┐
                                  │ Entity Resolution  │
                                  │  - blocking        │
                                  │  - candidate score │
                                  │  - LLM tiebreaker  │
                                  └────────┬───────────┘
                                            ▼
                                  ┌────────────────────┐
                                  │ Merge / Update     │
                                  │ companies/persons  │
                                  │ + field provenance │
                                  │ + diff → changes   │
                                  └────────┬───────────┘
                                            ▼
                                  ┌────────────────────┐
                                  │ Graph Sync         │
                                  │ (Neo4j upsert)     │
                                  └────────────────────┘
```

## Entity Resolution

### Шаг 1: Blocking (быстрый отсев)

Из всей БД достаём кандидатов:
- Точное совпадение по `bin/ogrn/inn/iin`
- Trigram similarity по `name_normalized > 0.7`
- Совпадение по телефону или домену
- Geo proximity (адрес в радиусе 200 м)

Результат: < 50 кандидатов на сущность.

### Шаг 2: Pairwise scoring

Каждой паре (новая сущность, кандидат) считаем feature-vector:
- `name_sim` (Jaro-Winkler)
- `address_sim`
- `phone_overlap` (bool)
- `domain_overlap` (bool)
- `director_overlap` (bool)
- `industry_match` (bool)
- `embedding_cosine` (bge-m3 на профилях)

Дальше: либо обученная XGBoost-модель (Phase 2), либо ручные веса (MVP) → score 0..1.

### Шаг 3: Решение

- `score > 0.9` → автоматический merge.
- `0.6 < score < 0.9` → `Task.DEDUPE_DECISION` (LLM Gemini Flash):
  передаём профили обеих сущностей + источники, просим JSON `{same: bool, reason: str, confidence: float}`.
- `score < 0.6` → создать новую сущность.
- Все спорные кейсы пишутся в `dedupe_review_queue` для ручной валидации (Phase 2 UI).

### Шаг 4: Merge

- `bin/ogrn` приоритетнее любого fuzzy.
- При конфликте полей берём значение с большей `confidence` или более свежий `extracted_at`.
- История всех изменений в `companies_changes`.
- Не удаляем «проигравшую» запись — переводим в `merged_into = UUID` и редиректим API-запросы.

## OSINT entity linking (cross-source)

Когда упоминание в новостях/Telegram надо связать с компанией:

1. **NER** на тексте (`Task.OSINT_ENTITY_LINKING`):
   - LLM возвращает `[{mention, entity_type, candidate_keys}]`.
2. **Кандидаты** ищем в Postgres по trigram + embedding similarity.
3. **Контекстный re-rank** через тот же LLM с контекстом (3 предложения вокруг упоминания).
4. **Запись связи** в Neo4j: `(:Article)-[:MENTIONS {confidence}]->(:Company)`.

## Графовая навигация (use cases)

- «Все компании, в которых директор N имел роль за последние 3 года» — 1 hop traversal.
- «Связи между двумя компаниями через общих учредителей или адреса» — shortest path до 4 hops.
- «Кластер компаний с общим телефоном/доменом» — comunity detection (label propagation).
- «Подозрительные паттерны массовой регистрации» — графовая аномалия (Phase 3).

Реализация: Cypher через `neo4j-driver`, фасад в `app.osint.graph`.

## Sanctions / risk overlay

Раз в день sync с источниками:
- OFAC SDN list
- ЕС санкционные списки
- ООН
- Реестры неблагонадёжных поставщиков goszakup/zakupki

Скрипт `scripts/sync_sanctions.py` нормализует и пишет в `sanctions_list`. Алёрт через event `EntityFlagged`.

## Качество данных (Data Quality SLOs)

| Метрика | Цель |
|---------|------|
| Поле `name` заполнено | 100% |
| Поле `industry_code` заполнено | > 80% |
| Provenance для каждого поля | 100% |
| Дубликаты автоматически смерджены | > 95% |
| False positive merge rate | < 0.5% (sampled) |

Скрипт `scripts/dq_report.py` гонять еженедельно, выводить отчёт.
