# RoadGuard AI — developer entry points
.PHONY: help setup backend frontend dev test test-backend test-frontend test-live build demo purge lint

help:
	@echo "RoadGuard AI"
	@echo "  make setup         install backend + frontend dependencies"
	@echo "  make backend       run the API on http://localhost:8000 (docs at /api/docs)"
	@echo "  make frontend      run the Vite dev server on http://localhost:5173"
	@echo "  make build         type-check + production build of the frontend"
	@echo "  make test          backend pytest + frontend vitest"
	@echo "  make test-live     frontend integration tests against a running API"
	@echo "  make demo          regenerate the synthetic demo dataset"
	@echo "  make purge         delete synthetic demo reports (real data untouched)"

setup:
	python3 -m pip install -r backend/requirements.txt
	cd frontend && npm install

backend:
	cd backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	cd backend && python3 -m pytest

test-frontend:
	cd frontend && npm run test

test-live:
	cd frontend && RUN_LIVE_TESTS=1 npx vitest run src/test/live-api.test.tsx

demo:
	cd backend && python3 -m app.services.demo_data --count 120

purge:
	cd backend && python3 -m app.services.demo_data --purge

lint:
	cd backend && python3 -m ruff check app tests || true
