"""Importing this package registers all forecast types via the @register decorator."""

from app.forecasting.models import (  # noqa: F401
    cac_ltv,
    market_growth,
    tam_sam_som,
    unit_economics,
)
