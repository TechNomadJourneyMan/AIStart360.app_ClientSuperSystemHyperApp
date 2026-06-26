# 07 — Crawling Infrastructure

## Стек

| Слой | Технология | Зачем |
|------|------------|-------|
| Backbone | **Scrapy** | планирование, retries, throttling, middlewares |
| JS rendering | **Playwright** (через scrapy-playwright) | SPA-сайты (2GIS, Kolesa, KZTA дашборды) |
| Anti-bot | **crawlee-python** + кастомные middlewares | fingerprinting, sessions |
| Прокси | **Bright Data / IPRoyal** (residential KZ/RU) | блокировки гос-регистров |
| Очередь | **Arq** (Redis) | enqueue crawl jobs из Discovery |
| Сторадж | **Cloudflare R2** | raw HTML/screenshots |
| Метаданные | Postgres `pages` | for resume, dedup, audit |

## Дизайн

Каждый источник = отдельный Scrapy spider в `backend/app/crawlers/spiders/`.

```
crawlers/
├── base.py                  # BaseSpider — общая логика (R2 upload, Postgres write)
├── middlewares.py           # ProxyMiddleware, RateLimitMiddleware, AntiBotMiddleware
├── spiders/
│   ├── kz_kgd.py            # КГД регистр
│   ├── kz_goszakup.py       # Госзакупки KZ
│   ├── kz_2gis.py           # 2GIS KZ (Playwright)
│   ├── ru_egrul.py
│   ├── ru_zakupki.py
│   ├── telegram.py          # Telegram-каналы через t.me/s/<channel>
│   └── ...
└── runner.py                # Запускается из Arq worker
```

## Контракт BaseSpider

```python
class BaseSpider(scrapy.Spider):
    source_key: str           # 'kz_kgd', 'kz_goszakup', ...
    rate_limit: dict          # {'requests_per_minute': 30, 'concurrency': 4}
    use_playwright: bool = False
    use_proxy: bool = True

    def make_seeds(self) -> Iterable[str]:
        """URL'ы для старта."""

    def parse(self, response):
        """Должен:
        1. Сохранить raw HTML в R2 → вернуть r2_key.
        2. Записать в `pages` (метаданные).
        3. Опционально извлечь следующие ссылки → yield Request.
        4. Опционально извлечь сырые поля (rule-based), сохранить в `extraction_queue`.
        """
```

Базовый класс делает retry, dedup (по url_hash), и публикует событие `PageFetched`.

## Anti-bot strategy

1. **User-Agent ротация** — pool из ~50 свежих UA, рандом на каждый request.
2. **Residential прокси** для gov-сайтов и 2GIS.
3. **Cookies/sessions** — sticky session на N запросов через `crawlee` SessionPool.
4. **TLS fingerprint** — patched httpx (`curl_cffi` под капотом).
5. **Headers ordering** — точная имитация Chrome.
6. **Rate limit per domain** — конфигурируется в spider.
7. **CAPTCHA**: для тех, кто требует — 2captcha API (Phase 2). На MVP — пропускаем, помечаем `blocked` в `pages`.
8. **Playwright stealth** — для SPA-сайтов, evasion-плагины.

## Robots.txt и закон

- Уважаем `robots.txt` для не-публичных registry (`/admin/`, `/api/internal/`).
- Гос-регистры — публичные данные, robots часто запрещает, но реестры открыты по закону.
- Personal data (телефоны, ИИН физлиц) — храним хэш если возможно, обнародованные данные — ок.
- 2GIS / коммерческие — соблюдаем rate limit, делаем человеческие паузы.

## Throttling

```python
# settings.py
DOWNLOAD_DELAY = 0.5
RANDOMIZE_DOWNLOAD_DELAY = True
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1
AUTOTHROTTLE_MAX_DELAY = 30
AUTOTHROTTLE_TARGET_CONCURRENCY = 4
```

Per-spider override через `custom_settings`.

## Дедупликация запросов

- URL → `url_hash = sha256(url)`.
- Перед скачиванием: проверяем `pages` — если страница свежее `min_refresh_age` (per source policy), пропускаем.
- `pages_refresh_policy` table:
  ```
  source       | min_age_hours | max_age_hours
  kz_kgd       | 168           | 720
  kz_2gis      | 24            | 168
  news_*       | 6             | 48
  ```

## Запуск из воркера

Arq job вызывает `await run_spider(source_key, seeds=..., job_id=...)`:

```python
# backend/app/workers/tasks/crawl.py
async def crawl_source(ctx, source_key: str, seeds: list[str], job_id: str):
    spider_cls = SPIDER_REGISTRY[source_key]
    settings = build_scrapy_settings(spider_cls)
    process = CrawlerProcess(settings)
    process.crawl(spider_cls, seeds=seeds, job_id=job_id)
    process.start(stop_after_crawl=True)
```

(Альтернатива: запускать Scrapy через subprocess, чище для resource isolation.)

## Cloudflare R2 layout

```
raw/
  {source}/
    {year}/{month}/{day}/
      {url_hash}.html.gz       ← gzipped HTML
      {url_hash}.png           ← screenshot (если playwright)
      {url_hash}.meta.json     ← {url, fetched_at, status, headers}
```

Lifecycle: храним 90 дней full HTML, потом архивируем (только meta + extracted fields остаётся).

## Observability

- Metric per spider: `pages_fetched_total{source}`, `pages_failed_total{source, reason}`, `crawl_duration_seconds{source}`.
- Алёрт: успешность падает ниже 80% за 1 час → Slack `#mark-crawl`.

## Список источников для MVP (Phase 1, 3 месяца)

1. **kz_goszakup** — KZ госзакупки (есть API, легко)
2. **kz_kompra** — агрегатор KZ компаний (HTML парсинг)
3. **kz_2gis** — KZ бизнес-каталог (Playwright)

После MVP добавляем по 2–3 источника в неделю.

## Sources

### `kz_stat` — Statistics Committee of KZ (BIN registry)

**Type:** scheduled bulk downloader (not a Scrapy spider).
**Code:** `app/crawlers/spiders/kz_stat.py`, `app/workers/tasks/kz_stat_refresh.py`, CLI `python -m app.jobs.run_kz_stat`.
**Cron:** weekly, Wednesday 03:00 KZ (UTC+5), registered as `cron(kz_stat_refresh, weekday="tues", hour={22})`.
**Freshness target:** Weekly (matches §7 hybrid matrix in `docs/aistart360/07-product-redesign.md`).
**Confidence band:** High (official, gov source). All upserted rows get `data_source="stat.gov.kz"`, `source_confidence=0.95`.
**Expected volume:** ~400K active legal entities total; ~200K landed in week 1 per the §6 estimate.

**Pipeline:**
1. Discovery: GET `https://stat.gov.kz/api/sbr/download` and regex out the first `.csv`/`.xlsx` anchor (URL discovery is **deferred** — the platform team rotates the path on each refresh). On miss, fall back to a hardcoded CSV URL.
2. Stream the CSV/XLSX to a tempfile (`tempfile.NamedTemporaryFile`). Never load 200K rows into memory at once.
3. Stream-parse with `csv.DictReader` in 5 000-row chunks. Russian headers (`БИН`, `Наименование`, `ОКЭД`, `КАТО`, `Статус`, `Адрес`, `Руководитель`) are matched case-insensitively.
4. Per chunk: `INSERT … ON CONFLICT (bin) DO UPDATE` via `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_update(...)`. Idempotent — second run with the same dataset yields 0 inserts / N updates.

**Schema-validation guard.** Before parsing any rows, the loader maps the CSV header against `REQUIRED_COLUMNS`. Missing any required canonical column → raises `KzStatSchemaError`, the ingest job is marked `failed` with `error="schema_error: ..."` in `ingest_jobs.error`, and **no rows are written**. This is the single biggest gotcha with stat.gov.kz — they reshuffle column names without notice (§11 risk matrix item).

**Block / captcha handling.** `httpx.AsyncClient.stream(...)` checks the response: 401/403/404/429 → `KzStatBlockedError`; HTML content-type when CSV expected → `KzStatBlockedError`. The Arq task catches it, marks the job `failed` with `payload={"retry_in_hours": 6}`, and enqueues a self-retry via `redis.enqueue_job("kz_stat_refresh", _defer_by=6*3600)`.

**Job tracking.** Every run records a row in `ingest_jobs` with `source="kz_stat"`, `kind="crawl"`, and final counts (`items_processed`, `items_added`, `items_updated`, `items_failed`).

