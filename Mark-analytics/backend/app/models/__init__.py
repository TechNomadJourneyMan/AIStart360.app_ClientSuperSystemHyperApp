"""Model re-exports — used by Alembic autogenerate to discover all tables."""

from app.models.address import Address
from app.models.ai_call_log import AICallLog
from app.models.alert import AlertEvent, AlertRule, ChannelKind, PendingAlert
from app.models.audit_log import AuditLog
from app.models.company import Company, CompanyChange, CompanyFieldProvenance
from app.models.digest import (
    DigestChannelKind,
    DigestRun,
    DigestRunStatus,
    DigestSubscription,
)
from app.models.domain_event import DomainEvent
from app.models.forecast import SavedForecast
from app.models.ingest_job import IngestJob
from app.models.news_item import NewsItemRecord
from app.models.page import Page
from app.models.person import Person
from app.models.processed_event import ProcessedEvent
from app.models.sanctions import SanctionsEntry
from app.models.saved_list import SavedList, SavedListItem
from app.models.source import Source
from app.models.tender import Tender
from app.models.upload import UserUpload
from app.models.user import User
from app.models.user_widget import UserWidget

# Side-effect import: registers SQLAlchemy event listener that powers the
# `companies_changes` CDC log. Keep last so all model classes are defined.
from app.models import _company_cdc  # noqa: F401  isort: skip

__all__ = [
    "AICallLog",
    "Address",
    "AlertEvent",
    "AlertRule",
    "AuditLog",
    "ChannelKind",
    "Company",
    "CompanyChange",
    "CompanyFieldProvenance",
    "DigestChannelKind",
    "DigestRun",
    "DigestRunStatus",
    "DigestSubscription",
    "DomainEvent",
    "IngestJob",
    "NewsItemRecord",
    "Page",
    "PendingAlert",
    "Person",
    "ProcessedEvent",
    "SanctionsEntry",
    "SavedForecast",
    "SavedList",
    "SavedListItem",
    "Source",
    "Tender",
    "User",
    "UserUpload",
    "UserWidget",
]
