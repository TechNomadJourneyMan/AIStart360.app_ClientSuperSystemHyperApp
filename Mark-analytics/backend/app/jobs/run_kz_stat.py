"""Manual trigger for the kz_stat BIN registry download.

Usage:
    python -m app.jobs.run_kz_stat              # discover URL automatically
    python -m app.jobs.run_kz_stat --url <CSV>  # force a specific dataset URL
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.crawlers.spiders.kz_stat import (
    KzStatBlockedError,
    KzStatSchemaError,
    run_kz_stat_download,
)
from app.workers.tasks.kz_stat_refresh import kz_stat_refresh


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download stat.gov.kz BIN registry.")
    parser.add_argument("--url", help="Force a specific dataset URL (skip discovery).")
    parser.add_argument(
        "--no-job", action="store_true",
        help="Skip creating an ingest_jobs row — useful for one-shot debugging.",
    )
    return parser.parse_args(argv)


async def _amain(args: argparse.Namespace) -> int:
    if args.no_job:
        try:
            result = await run_kz_stat_download(dataset_url=args.url)
        except KzStatSchemaError as e:
            print(f"schema_error: {e}", file=sys.stderr)
            return 2
        except KzStatBlockedError as e:
            print(f"blocked: {e}", file=sys.stderr)
            return 3
        print(result.as_dict())
        return 0

    # Default: go through the Arq task so the ingest_jobs row is created.
    out = await kz_stat_refresh({}, dataset_url=args.url)
    print(out)
    return 0 if out.get("status") in {"ok", "partial"} else 1


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_amain(_parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
