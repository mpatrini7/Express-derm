.PHONY: setup-python start start-research-ai start-gpu backend \
	backend-research-ai frontend frontend-deps migrate \
	test-backend test-frontend typecheck check demo-check cpp-worker

PYTHON_ENV_DIR ?= $(CURDIR)/.runtime/python
BOOTSTRAP_PYTHON ?= python3
PYTHON ?= $(PYTHON_ENV_DIR)/bin/python
PIP_INSTALL_FLAGS ?= --disable-pip-version-check
EXPRESS_DERM_AI_ENABLED ?= true
EXPRESS_DERM_AI_BACKEND ?= onnxruntime
EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL ?= true
EXPRESS_DERM_AI_REQUIRED ?= true
EXPRESS_DERM_AI_MODEL_DIR ?= models/express-derm-1

setup-python:
	@EXPRESS_DERM_BOOTSTRAP_PYTHON="$(BOOTSTRAP_PYTHON)" \
	EXPRESS_DERM_PYTHON_ENV_DIR="$(PYTHON_ENV_DIR)" \
	EXPRESS_DERM_TARGET_PYTHON="$(PYTHON)" \
	EXPRESS_DERM_PIP_INSTALL_FLAGS="$(PIP_INSTALL_FLAGS)" \
	./scripts/ensure_python_dependencies.sh

frontend-deps:
	./scripts/ensure_frontend_dependencies.sh

start: setup-python
	@BACKEND_PYTHON="$(PYTHON)" \
	EXPRESS_DERM_AI_ENABLED="$(EXPRESS_DERM_AI_ENABLED)" \
	EXPRESS_DERM_AI_BACKEND="$(EXPRESS_DERM_AI_BACKEND)" \
	EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL="$(EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL)" \
	EXPRESS_DERM_AI_REQUIRED="$(EXPRESS_DERM_AI_REQUIRED)" \
	EXPRESS_DERM_AI_MODEL_DIR="$(EXPRESS_DERM_AI_MODEL_DIR)" \
	./scripts/start_project.sh

start-research-ai: start

start-gpu: setup-python
	@BACKEND_PYTHON="$(PYTHON)" START_PROJECT_ENV_FILE=scripts/gpu.env ./scripts/start_project.sh

backend: setup-python
	cd backend && $(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

backend-research-ai: backend

frontend: frontend-deps
	cd frontend && npm run dev -- --host 0.0.0.0

migrate: setup-python
	cd backend && $(PYTHON) -m alembic -c alembic.ini upgrade head

cpp-worker:
	./scripts/build_cpp_ai_worker.sh

test-backend: setup-python
	cd backend && $(PYTHON) -m pytest

test-frontend: frontend-deps
	cd frontend && npm test

typecheck: frontend-deps
	cd frontend && npm run typecheck

check: test-backend test-frontend typecheck

demo-check: setup-python
	cd backend && $(PYTHON) -m pytest tests/test_challenge_demo_sample.py
