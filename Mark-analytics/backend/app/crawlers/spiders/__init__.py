"""Spider registry. Importing this module triggers registration of all known spiders.

Note: ``kz_stat`` is a **downloader**, not a Scrapy/SimpleHttpSpider class — it
is invoked directly via :mod:`app.workers.tasks.kz_stat_refresh` (Arq cron) and
:mod:`app.jobs.run_kz_stat` (manual CLI). It deliberately does **not** appear in
``SPIDER_REGISTRY`` since :func:`app.crawlers.runner.run_spider` is built for
URL-iterating spiders, not bulk file downloads.
"""

from app.crawlers.spiders.kz_goszakup import KzGoszakupSpider
from app.crawlers.spiders.kz_stat_gov import KzStatGovSpider

SPIDER_REGISTRY = {
    KzGoszakupSpider.source_key: KzGoszakupSpider,
    KzStatGovSpider.source_key: KzStatGovSpider,
}

__all__ = ["SPIDER_REGISTRY", "KzGoszakupSpider", "KzStatGovSpider"]
