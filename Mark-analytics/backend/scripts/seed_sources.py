#!/usr/bin/env python3
"""Seed the `sources` registry with 40+ public/free-tier data providers.

Idempotent — re-running this script updates metadata for existing keys and
inserts new ones (`ON CONFLICT (key) DO UPDATE`).

Usage:
    python backend/scripts/seed_sources.py            # apply to DATABASE_URL
    python backend/scripts/seed_sources.py --dry-run  # print plan, no writes
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

# Allow running as `python backend/scripts/seed_sources.py` without installing.
_REPO_BACKEND = Path(__file__).resolve().parent.parent
if str(_REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(_REPO_BACKEND))

# `app.db.session` reads DATABASE_URL eagerly via Settings — deferred to keep
# `--dry-run` runnable without a configured environment.


# ────────────────────────────────────────────────────────────────────────
# Registry definition — keep keys stable; they are referenced by spiders,
# crawler queues and the admin UI.
# ────────────────────────────────────────────────────────────────────────


def _src(
    key: str,
    name: str,
    *,
    kind: str,
    base_url: str,
    category: str,
    geo_scope: str,
    priority: int,
    response_format: str,
    auth_type: str = "none",
    free_tier_limits: dict[str, Any] | None = None,
    docs_url: str | None = None,
    rate_limit_rpm: int = 30,
    refresh_min_hours: int = 168,
    refresh_max_hours: int = 720,
    enabled: bool | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Construct a registry row. `enabled` defaults to True for P0–P2, False for P3+."""
    if enabled is None:
        enabled = priority <= 7
    return {
        "key": key,
        "name": name,
        "kind": kind,
        "base_url": base_url,
        "rate_limit_rpm": rate_limit_rpm,
        "refresh_min_hours": refresh_min_hours,
        "refresh_max_hours": refresh_max_hours,
        "enabled": enabled,
        "auth_type": auth_type,
        "free_tier_limits": free_tier_limits,
        "docs_url": docs_url,
        "response_format": response_format,
        "geo_scope": geo_scope,
        "category": category,
        "priority": priority,
        "health_status": "untested",
        "notes": notes,
    }


SOURCES: list[dict[str, Any]] = [
    # ════════════════════════════════════════════════════════════
    # KZ Government (P0–P1)
    # ════════════════════════════════════════════════════════════
    _src("kz_stat_gov", "БНС РК (stat.gov.kz)",
         kind="registry", base_url="https://stat.gov.kz/api/sbr/iAccessdata",
         category="macro", geo_scope="kz", priority=1, response_format="json",
         docs_url="https://stat.gov.kz/api/sbr",
         notes="Бюро национальной статистики РК. iAccessdata API. Без авторизации."),
    _src("kz_egov_data", "data.egov.kz",
         kind="registry", base_url="https://data.egov.kz/api/v4/",
         category="macro", geo_scope="kz", priority=1, response_format="json",
         auth_type="registration",
         docs_url="https://data.egov.kz/page/api",
         notes="Открытые данные РК. Бесплатная регистрация для apiKey."),
    _src("kz_goszakup", "Госзакупки РК (goszakup.gov.kz)",
         kind="tender", base_url="https://ows.goszakup.gov.kz/v3/",
         category="tenders", geo_scope="kz", priority=1, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_minute": 60},
         docs_url="https://ows.goszakup.gov.kz/v3/swagger",
         rate_limit_rpm=60, refresh_min_hours=6, refresh_max_hours=24,
         notes="OWS v3. Токен запрашивается у госзакупок."),
    _src("kz_adilet", "Adilet (adilet.zan.kz)",
         kind="scrape", base_url="https://adilet.zan.kz/",
         category="macro", geo_scope="kz", priority=2, response_format="html",
         notes="НПА РК. Нет публичного API — скрейпинг."),
    _src("kz_kgd", "КГД МФ РК (kgd.gov.kz)",
         kind="registry", base_url="https://kgd.gov.kz/",
         category="ownership", geo_scope="kz", priority=2, response_format="json",
         notes="Налоговая. Частичный API + скрейпинг (поиск по БИН)."),
    _src("kz_nbk", "Национальный банк РК",
         kind="api", base_url="https://nationalbank.kz/rss/get_rates.cfm",
         category="markets", geo_scope="kz", priority=1, response_format="xml",
         docs_url="https://nationalbank.kz/?docid=748",
         rate_limit_rpm=10, refresh_min_hours=4, refresh_max_hours=24,
         notes="Курсы валют XML/RSS. Без ключа."),
    _src("kz_kase", "KASE (kase.kz)",
         kind="api", base_url="https://kase.kz/api/",
         category="markets", geo_scope="kz", priority=1, response_format="json",
         rate_limit_rpm=30, refresh_min_hours=4, refresh_max_hours=24,
         notes="Казахстанская фондовая биржа. Публичные котировки/индексы."),
    _src("kz_aifc", "AFSA registry (AIFC)",
         kind="scrape", base_url="https://publicreg.myafsa.com/",
         category="ownership", geo_scope="kz", priority=2, response_format="html",
         notes="Реестр участников МФЦА. Только скрейпинг."),
    _src("kz_astana_hub", "Astana Hub residents",
         kind="scrape", base_url="https://astanahub.com/en/service/residents/",
         category="ownership", geo_scope="kz", priority=2, response_format="html",
         notes="Резиденты Astana Hub. Скрейпинг каталога."),

    # ════════════════════════════════════════════════════════════
    # CIS Government (P2)
    # ════════════════════════════════════════════════════════════
    _src("ru_cbr", "ЦБ РФ — курсы валют",
         kind="api", base_url="https://www.cbr.ru/scripts/XML_daily.asp",
         category="markets", geo_scope="cis", priority=3, response_format="xml",
         rate_limit_rpm=60, refresh_min_hours=24, refresh_max_hours=24,
         docs_url="https://cbr.ru/development/SXML/",
         notes="ЦБ России. Бесплатный XML-фид ежедневных курсов."),
    _src("uz_cb", "ЦБ Узбекистана",
         kind="api", base_url="https://cbu.uz/oz/arkhiv-kursov-valyut/json/",
         category="markets", geo_scope="cis", priority=4, response_format="json",
         rate_limit_rpm=30, refresh_min_hours=24, refresh_max_hours=48,
         notes="Курсы валют РУз, JSON-фид."),
    _src("by_cb", "НБ Республики Беларусь",
         kind="api", base_url="https://api.nbrb.by/exrates/rates",
         category="markets", geo_scope="cis", priority=4, response_format="json",
         rate_limit_rpm=60, refresh_min_hours=24, refresh_max_hours=48,
         docs_url="https://www.nbrb.by/apihelp/exrates",
         notes="Официальный API НБ РБ."),

    # ════════════════════════════════════════════════════════════
    # Global Finance (P0–P1)
    # ════════════════════════════════════════════════════════════
    _src("worldbank_api", "World Bank Open Data",
         kind="api", base_url="https://api.worldbank.org/v2/",
         category="macro", geo_scope="global", priority=1, response_format="json",
         free_tier_limits={"notes": "no documented hard limit, be polite"},
         docs_url="https://datahelpdesk.worldbank.org/knowledgebase/topics/125589",
         rate_limit_rpm=60, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Полностью бесплатно, без ключа."),
    _src("imf_data", "IMF DataMapper API",
         kind="api", base_url="https://www.imf.org/external/datamapper/api/v1/",
         category="macro", geo_scope="global", priority=2, response_format="json",
         docs_url="https://www.imf.org/external/datamapper/api/help",
         refresh_min_hours=720, refresh_max_hours=2160,
         notes="WEO, GFS и другие датасеты МВФ."),
    _src("oecd_stats", "OECD SDMX-JSON",
         kind="api", base_url="https://stats.oecd.org/SDMX-JSON/",
         category="macro", geo_scope="global", priority=2, response_format="json",
         docs_url="https://data.oecd.org/api/sdmx-json-documentation/",
         refresh_min_hours=720, refresh_max_hours=2160,
         notes="SDMX endpoints. Бесплатно."),
    _src("fred", "FRED (St. Louis Fed)",
         kind="api", base_url="https://api.stlouisfed.org/fred/",
         category="macro", geo_scope="global", priority=1, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_day": 120000},
         docs_url="https://fred.stlouisfed.org/docs/api/fred/",
         rate_limit_rpm=120, refresh_min_hours=24, refresh_max_hours=168,
         notes="Бесплатный ключ. Очень щедрые лимиты."),
    _src("ecb_api", "European Central Bank",
         kind="api", base_url="https://data-api.ecb.europa.eu/service/data/",
         category="markets", geo_scope="global", priority=2, response_format="json",
         docs_url="https://data.ecb.europa.eu/help/api/overview",
         refresh_min_hours=24, refresh_max_hours=168,
         notes="SDMX 2.1. Без ключа."),
    _src("eurostat", "Eurostat",
         kind="api", base_url="https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/",
         category="macro", geo_scope="global", priority=2, response_format="json",
         docs_url="https://wikis.ec.europa.eu/display/EUROSTATHELP/API+Statistics",
         refresh_min_hours=720, refresh_max_hours=2160,
         notes="Без ключа, REST + SDMX."),
    _src("frankfurter", "Frankfurter FX",
         kind="api", base_url="https://api.frankfurter.app/",
         category="markets", geo_scope="global", priority=1, response_format="json",
         docs_url="https://www.frankfurter.app/docs/",
         rate_limit_rpm=60, refresh_min_hours=24, refresh_max_hours=48,
         notes="ECB-based FX rates. Без ключа."),
    _src("exchangerate_host", "exchangerate.host",
         kind="api", base_url="https://api.exchangerate.host/",
         category="markets", geo_scope="global", priority=2, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_month": 100},
         docs_url="https://exchangerate.host/documentation",
         rate_limit_rpm=10, refresh_min_hours=24, refresh_max_hours=48,
         notes="С 2024 требуется бесплатный ключ APILayer."),

    # ════════════════════════════════════════════════════════════
    # Markets (P1)
    # ════════════════════════════════════════════════════════════
    _src("alphavantage", "Alpha Vantage",
         kind="api", base_url="https://www.alphavantage.co/query",
         category="markets", geo_scope="global", priority=2, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_minute": 5, "requests_per_day": 25},
         docs_url="https://www.alphavantage.co/documentation/",
         rate_limit_rpm=5, refresh_min_hours=24, refresh_max_hours=168,
         notes="Free tier очень узкий — кешировать агрессивно."),
    _src("yahoo_finance", "Yahoo Finance (unofficial)",
         kind="scrape", base_url="https://query1.finance.yahoo.com/",
         category="markets", geo_scope="global", priority=3, response_format="json",
         rate_limit_rpm=30, refresh_min_hours=12, refresh_max_hours=24,
         notes="Через yfinance package. ToS серая зона."),
    _src("polygon_io", "Polygon.io",
         kind="api", base_url="https://api.polygon.io/",
         category="markets", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_minute": 5},
         docs_url="https://polygon.io/docs",
         rate_limit_rpm=5, refresh_min_hours=24, refresh_max_hours=168,
         notes="Free tier: end-of-day, 5 req/min."),
    _src("finnhub", "Finnhub",
         kind="api", base_url="https://finnhub.io/api/v1/",
         category="markets", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_minute": 60},
         docs_url="https://finnhub.io/docs/api",
         rate_limit_rpm=60, refresh_min_hours=12, refresh_max_hours=24,
         notes="Free tier нормальный, но без forex/crypto."),
    _src("coingecko", "CoinGecko",
         kind="api", base_url="https://api.coingecko.com/api/v3/",
         category="markets", geo_scope="global", priority=3, response_format="json",
         free_tier_limits={"requests_per_minute": 10, "requests_per_month": 10000},
         docs_url="https://docs.coingecko.com/reference/introduction",
         rate_limit_rpm=10, refresh_min_hours=4, refresh_max_hours=24,
         notes="Без ключа на public endpoint, лимиты IP-based."),

    # ════════════════════════════════════════════════════════════
    # Sanctions (P0)
    # ════════════════════════════════════════════════════════════
    _src("ofac_sdn", "US Treasury OFAC SDN",
         kind="dataset", base_url="https://www.treasury.gov/ofac/downloads/sdn.xml",
         category="sanctions", geo_scope="global", priority=1, response_format="xml",
         docs_url="https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists",
         rate_limit_rpm=10, refresh_min_hours=24, refresh_max_hours=24,
         notes="Полный SDN список. Обновляется ежедневно."),
    _src("eu_sanctions", "EU Consolidated Sanctions",
         kind="dataset",
         base_url="https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content",
         category="sanctions", geo_scope="global", priority=1, response_format="xml",
         auth_type="registration",
         docs_url="https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content",
         rate_limit_rpm=10, refresh_min_hours=24, refresh_max_hours=24,
         notes="Требуется бесплатный token query-param."),
    _src("uk_sanctions", "UK OFSI Consolidated List",
         kind="dataset",
         base_url="https://www.gov.uk/government/publications/financial-sanctions-consolidated-list-of-targets",
         category="sanctions", geo_scope="global", priority=2, response_format="csv",
         rate_limit_rpm=5, refresh_min_hours=24, refresh_max_hours=48,
         notes="ODT/CSV дамп публикуется ежедневно."),
    _src("un_sanctions", "UN Security Council Consolidated List",
         kind="dataset", base_url="https://scsanctions.un.org/resources/xml/en/consolidated.xml",
         category="sanctions", geo_scope="global", priority=1, response_format="xml",
         rate_limit_rpm=5, refresh_min_hours=24, refresh_max_hours=48,
         notes="XML, без ключа."),
    _src("opensanctions", "OpenSanctions",
         kind="dataset", base_url="https://data.opensanctions.org/",
         category="sanctions", geo_scope="global", priority=1, response_format="json",
         docs_url="https://www.opensanctions.org/docs/api/",
         rate_limit_rpm=30, refresh_min_hours=24, refresh_max_hours=24,
         notes="FtM-данные + Match API. Bulk download бесплатно."),
    _src("opencorporates", "OpenCorporates",
         kind="api", base_url="https://api.opencorporates.com/v0.4/",
         category="ownership", geo_scope="global", priority=2, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_month": 500, "requests_per_day": 50},
         docs_url="https://api.opencorporates.com/documentation/API-Reference",
         rate_limit_rpm=10, refresh_min_hours=168, refresh_max_hours=720,
         notes="Free tier очень узкий, нужен ключ."),

    # ════════════════════════════════════════════════════════════
    # News & Media (P1)
    # ════════════════════════════════════════════════════════════
    _src("gdelt", "GDELT Project",
         kind="api", base_url="https://api.gdeltproject.org/api/v2/doc/doc",
         category="news", geo_scope="global", priority=2, response_format="json",
         docs_url="https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/",
         rate_limit_rpm=30, refresh_min_hours=1, refresh_max_hours=6,
         notes="Полнотекстовый поиск мировых новостей. Без ключа."),
    _src("newsapi_org", "NewsAPI.org",
         kind="api", base_url="https://newsapi.org/v2/",
         category="news", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_day": 100},
         docs_url="https://newsapi.org/docs",
         rate_limit_rpm=10, refresh_min_hours=4, refresh_max_hours=24,
         notes="Dev-only на free tier (24h задержка)."),
    _src("kursiv_rss", "Kursiv.kz RSS",
         kind="rss", base_url="https://kursiv.kz/feed/",
         category="news", geo_scope="kz", priority=2, response_format="rss",
         rate_limit_rpm=10, refresh_min_hours=1, refresh_max_hours=6,
         notes="Бизнес-новости РК."),
    _src("forbes_kz_rss", "Forbes.kz RSS",
         kind="rss", base_url="https://forbes.kz/rss/",
         category="news", geo_scope="kz", priority=2, response_format="rss",
         rate_limit_rpm=10, refresh_min_hours=1, refresh_max_hours=6,
         notes="Forbes Казахстан."),
    _src("tengrinews_rss", "Tengrinews RSS",
         kind="rss", base_url="https://tengrinews.kz/rss/",
         category="news", geo_scope="kz", priority=2, response_format="rss",
         rate_limit_rpm=10, refresh_min_hours=1, refresh_max_hours=6,
         notes="Общая лента tengrinews.kz."),
    _src("inbusiness_rss", "Inbusiness.kz RSS",
         kind="rss", base_url="https://inbusiness.kz/ru/rss",
         category="news", geo_scope="kz", priority=2, response_format="rss",
         rate_limit_rpm=10, refresh_min_hours=1, refresh_max_hours=6,
         notes="Деловые новости РК."),
    _src("bes_media_rss", "Bes.media RSS",
         kind="rss", base_url="https://bes.media/feed/",
         category="news", geo_scope="kz", priority=3, response_format="rss",
         rate_limit_rpm=10, refresh_min_hours=2, refresh_max_hours=12,
         notes="Bes.media — независимая редакция."),

    # ════════════════════════════════════════════════════════════
    # OSINT / Infrastructure (P1)
    # ════════════════════════════════════════════════════════════
    _src("crt_sh", "crt.sh (Certificate Transparency)",
         kind="api", base_url="https://crt.sh/",
         category="osint", geo_scope="global", priority=2, response_format="json",
         rate_limit_rpm=10, refresh_min_hours=168, refresh_max_hours=720,
         notes="Поиск SSL-сертификатов. Polite QPS."),
    _src("shodan", "Shodan",
         kind="api", base_url="https://api.shodan.io/",
         category="osint", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         free_tier_limits={"notes": "Free tier — 1 credit, для развёрнутого нужен membership"},
         docs_url="https://developer.shodan.io/api",
         rate_limit_rpm=10, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Free очень ограничен."),
    _src("cloudflare_radar", "Cloudflare Radar",
         kind="api", base_url="https://api.cloudflare.com/client/v4/radar/",
         category="osint", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         docs_url="https://developers.cloudflare.com/radar/get-started/first-request/",
         rate_limit_rpm=60, refresh_min_hours=24, refresh_max_hours=168,
         notes="Бесплатно с Cloudflare-аккаунтом."),
    _src("github_api", "GitHub REST API",
         kind="api", base_url="https://api.github.com/",
         category="osint", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_hour": 5000},
         docs_url="https://docs.github.com/en/rest",
         rate_limit_rpm=83, refresh_min_hours=24, refresh_max_hours=168,
         notes="С PAT — 5000/h, без него — 60/h."),
    _src("whoisxml", "WhoisXML API",
         kind="api", base_url="https://www.whoisxmlapi.com/whoisserver/WhoisService",
         category="osint", geo_scope="global", priority=4, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_month": 500},
         docs_url="https://whois.whoisxmlapi.com/documentation/making-requests",
         rate_limit_rpm=10, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Free tier 500 lookups/мес."),

    # ════════════════════════════════════════════════════════════
    # Geo / Weather (P1)
    # ════════════════════════════════════════════════════════════
    _src("nominatim", "OpenStreetMap Nominatim",
         kind="api", base_url="https://nominatim.openstreetmap.org/",
         category="geo", geo_scope="global", priority=2, response_format="json",
         free_tier_limits={"requests_per_second": 1},
         docs_url="https://nominatim.org/release-docs/develop/api/Overview/",
         rate_limit_rpm=60, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Используем для редких lookups. Для масштаба — self-host."),
    _src("overpass", "Overpass API (OSM)",
         kind="api", base_url="https://overpass-api.de/api/interpreter",
         category="geo", geo_scope="global", priority=3, response_format="json",
         free_tier_limits={"notes": "fair-use, ~1Gb/day per IP"},
         docs_url="https://wiki.openstreetmap.org/wiki/Overpass_API",
         rate_limit_rpm=5, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Heavy queries — кешировать."),
    _src("maptiler", "MapTiler",
         kind="api", base_url="https://api.maptiler.com/",
         category="geo", geo_scope="global", priority=4, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_month": 100000},
         docs_url="https://docs.maptiler.com/cloud/api/",
         rate_limit_rpm=60, refresh_min_hours=720, refresh_max_hours=2160,
         notes="100k tiles/мес бесплатно."),
    _src("stadia_maps", "Stadia Maps",
         kind="api", base_url="https://tiles.stadiamaps.com/",
         category="geo", geo_scope="global", priority=4, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_day": 200000},
         docs_url="https://docs.stadiamaps.com/",
         rate_limit_rpm=60, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Бесплатно для non-commercial и dev."),
    _src("open_meteo", "Open-Meteo",
         kind="api", base_url="https://api.open-meteo.com/v1/",
         category="weather", geo_scope="global", priority=2, response_format="json",
         free_tier_limits={"requests_per_day": 10000, "requests_per_minute": 600},
         docs_url="https://open-meteo.com/en/docs",
         rate_limit_rpm=600, refresh_min_hours=1, refresh_max_hours=6,
         notes="Полностью бесплатно без ключа."),
    _src("openweathermap", "OpenWeatherMap",
         kind="api", base_url="https://api.openweathermap.org/data/2.5/",
         category="weather", geo_scope="global", priority=4, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_day": 1000, "requests_per_minute": 60},
         docs_url="https://openweathermap.org/api",
         rate_limit_rpm=60, refresh_min_hours=1, refresh_max_hours=6,
         notes="Free tier 1k вызовов/день."),
    _src("usgs_earthquake", "USGS Earthquake Feeds",
         kind="api", base_url="https://earthquake.usgs.gov/fdsnws/event/1/",
         category="geo", geo_scope="global", priority=4, response_format="json",
         docs_url="https://earthquake.usgs.gov/fdsnws/event/1/",
         rate_limit_rpm=60, refresh_min_hours=1, refresh_max_hours=6,
         notes="Бесплатно, без ключа."),
    _src("noaa_weather", "NOAA Weather API",
         kind="api", base_url="https://api.weather.gov/",
         category="weather", geo_scope="global", priority=4, response_format="json",
         docs_url="https://www.weather.gov/documentation/services-web-api",
         rate_limit_rpm=60, refresh_min_hours=1, refresh_max_hours=12,
         notes="US-only прогноз, бесплатно."),

    # ════════════════════════════════════════════════════════════
    # Trade (P2)
    # ════════════════════════════════════════════════════════════
    _src("un_comtrade", "UN Comtrade",
         kind="api", base_url="https://comtradeapi.un.org/data/v1/",
         category="trade", geo_scope="global", priority=3, response_format="json",
         auth_type="api_key",
         free_tier_limits={"requests_per_hour": 250, "requests_per_day": 500},
         docs_url="https://comtradeplus.un.org/Help",
         rate_limit_rpm=10, refresh_min_hours=720, refresh_max_hours=2160,
         notes="Free tier требует регистрации."),
    _src("imf_dot", "IMF Direction of Trade",
         kind="api", base_url="http://dataservices.imf.org/REST/SDMX_JSON.svc/Data/DOT/",
         category="trade", geo_scope="global", priority=4, response_format="json",
         docs_url="https://datahelp.imf.org/knowledgebase/articles/667681",
         refresh_min_hours=720, refresh_max_hours=2160,
         notes="Бесплатно, без ключа."),

    # ════════════════════════════════════════════════════════════
    # Patents (P2)
    # ════════════════════════════════════════════════════════════
    _src("uspto", "USPTO Open Data",
         kind="api", base_url="https://developer.uspto.gov/api-catalog",
         category="patents", geo_scope="global", priority=5, response_format="json",
         docs_url="https://developer.uspto.gov/",
         refresh_min_hours=720, refresh_max_hours=2160,
         notes="Несколько endpoint'ов, бесплатно."),
    _src("wipo_global_brand", "WIPO Global Brand DB",
         kind="scrape", base_url="https://branddb.wipo.int/branddb/en/",
         category="patents", geo_scope="global", priority=6, response_format="html",
         refresh_min_hours=2160, refresh_max_hours=8760,
         notes="Нет открытого API — скрейпинг."),

    # ════════════════════════════════════════════════════════════
    # Climate / Misc (P3)
    # ════════════════════════════════════════════════════════════
    _src("climate_trace", "Climate TRACE",
         kind="dataset", base_url="https://api.climatetrace.org/v6/",
         category="climate", geo_scope="global", priority=8, response_format="json",
         enabled=False,
         docs_url="https://api.climatetrace.org/v6/swagger/index.html",
         refresh_min_hours=720, refresh_max_hours=2160,
         notes="Эмиссии CO2 по объектам. Free."),
    _src("eiti", "EITI Open Data",
         kind="dataset", base_url="https://eiti.org/api/v1.0/",
         category="climate", geo_scope="global", priority=8, response_format="json",
         enabled=False,
         docs_url="https://eiti.org/api",
         refresh_min_hours=2160, refresh_max_hours=8760,
         notes="Прозрачность доходов добывающих отраслей."),
]


# ────────────────────────────────────────────────────────────────────────


async def upsert_sources(rows: list[dict[str, Any]]) -> tuple[int, int]:
    """Upsert via ON CONFLICT (key). Returns (inserted_or_updated, total)."""
    if not rows:
        return 0, 0

    # Deferred imports so `--dry-run` works without DATABASE_URL set.
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.db.session import async_session_factory
    from app.models.source import Source

    table = Source.__table__
    affected = 0
    async with async_session_factory() as session:
        for row in rows:
            stmt = pg_insert(table).values(**row)
            update_cols = {c: stmt.excluded[c] for c in row if c != "key"}
            # Preserve manual edits to enabled/priority/notes if already set?
            # Decision: this is a seed — explicitly overwrite metadata fields
            # but keep operator-mutable runtime fields (health_status,
            # last_health_check) untouched on conflict.
            update_cols.pop("health_status", None)
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"], set_=update_cols,
            )
            await session.execute(stmt)
            affected += 1
        await session.commit()
    return affected, len(rows)


def plan_only(rows: list[dict[str, Any]]) -> None:
    by_cat: dict[str, int] = {}
    by_geo: dict[str, int] = {}
    enabled = 0
    for r in rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
        by_geo[r["geo_scope"]] = by_geo.get(r["geo_scope"], 0) + 1
        if r["enabled"]:
            enabled += 1
    print(f"[dry-run] {len(rows)} sources, {enabled} enabled")
    print("  by category:")
    for k, v in sorted(by_cat.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"    {k:<12} {v}")
    print("  by geo:")
    for k, v in sorted(by_geo.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"    {k:<12} {v}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print summary and exit without DB writes")
    args = parser.parse_args()

    if args.dry_run:
        plan_only(SOURCES)
        return

    affected, total = asyncio.run(upsert_sources(SOURCES))
    print(f"seeded {affected}/{total} source rows")


if __name__ == "__main__":
    main()
