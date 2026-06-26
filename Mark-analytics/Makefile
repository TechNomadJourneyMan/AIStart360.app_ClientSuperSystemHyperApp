.DEFAULT_GOAL := help
.PHONY: help dev test lint fmt typecheck migrate up down build agents

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n",$$1,$$2}'

up: ## Start local Postgres+Redis+MinIO
	docker compose -f infra/docker/docker-compose.yml up -d

down: ## Stop local services
	docker compose -f infra/docker/docker-compose.yml down

dev: up ## Start everything and run API with --reload
	cd backend && uvicorn app.main:app --reload --port 8000

worker: ## Run Arq worker locally
	cd backend && arq app.workers.main.WorkerSettings

test: ## Run unit tests (no integration/live)
	cd backend && pytest -q -m "not integration and not live"

test-all: ## Run ALL tests including integration
	cd backend && pytest -q

lint: ## Ruff lint
	cd backend && ruff check .

fmt: ## Ruff format
	cd backend && ruff format .

typecheck: ## Mypy strict
	cd backend && mypy app/

migrate: ## Alembic upgrade head
	cd backend && alembic upgrade head

migrate-new: ## Create a new migration: make migrate-new NAME=description
	cd backend && alembic revision --autogenerate -m "$(NAME)"

build: ## Build API + worker docker images
	docker build -f infra/docker/Dockerfile.api -t mark-api:dev backend
	docker build -f infra/docker/Dockerfile.worker -t mark-worker:dev backend

agents: ## List available .claude/agents
	@ls .claude/agents/ | sed 's/\.md$$//'
