"""One-shot CLI jobs (manual triggers, backfills).

Each module in this package exposes a ``main()`` coroutine so it can be run
as ``python -m app.jobs.<name>``. Useful for manual backfills, smoke tests,
and CI seed steps where pulling in the full Arq worker is overkill.
"""
