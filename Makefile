SHELL := /bin/sh

# The Go server owns this port and proxies the app; Vite is the editor behind it.
PORT ?= 8080
VITE_PORT ?= 5174
FRONTEND := frontend
BACKEND := backend

.DEFAULT_GOAL := help

.PHONY: help install dev frontend backend test test-frontend test-backend build fmt

help: ## this list
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

install: ## install the frontend dependencies from the lockfile
	cd $(FRONTEND) && npm ci

# A fresh clone has no node_modules, and `make dev` runs Vite straight out of it,
# so the first `make dev` installs instead of failing with "command not found".
$(FRONTEND)/node_modules: $(FRONTEND)/package-lock.json $(FRONTEND)/package.json
	cd $(FRONTEND) && npm ci

dev: $(FRONTEND)/node_modules ## run the editor and the card server together on :8080
	@echo "lightgram dev → http://localhost:$(PORT)  (editor, share links, preview cards)"
	@cd $(BACKEND) && go build -o bin/lightgram ./cmd/lightgram
	@( cd $(BACKEND) && exec ./bin/lightgram -port $(PORT) -dev -proxy http://localhost:$(VITE_PORT) ) & \
	backend=$$!; \
	( cd $(FRONTEND) && LIGHTGRAM_SERVER_PORT=$(PORT) exec ./node_modules/.bin/vite --port $(VITE_PORT) --strictPort ) & \
	frontend=$$!; \
	trap 'kill $$backend $$frontend 2>/dev/null; wait 2>/dev/null' INT TERM EXIT; \
	wait

backend: ## the card server alone, proxying to an already running vite
	cd $(BACKEND) && go run ./cmd/lightgram -port $(PORT) -dev -proxy http://localhost:$(VITE_PORT)

frontend: $(FRONTEND)/node_modules ## the playground alone (no preview cards)
	cd $(FRONTEND) && LIGHTGRAM_SERVER_PORT=$(PORT) ./node_modules/.bin/vite --port $(VITE_PORT) --strictPort

test: test-frontend test-backend ## every test, both languages, plus the typecheck

test-frontend:
	cd $(FRONTEND) && npm test && npx tsc --noEmit

test-backend:
	cd $(BACKEND) && go vet ./... && go test ./...

build: ## typecheck the frontend, then build both halves
	cd $(FRONTEND) && npm run build
	cd $(BACKEND) && go build -o bin/lightgram ./cmd/lightgram

fmt: ## gofmt the server
	cd $(BACKEND) && gofmt -w .
