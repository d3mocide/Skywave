# Skywave — one-command deployment.
#
#   make up                  start the dev stack, built from source
#   make all DXSPIDER_LOGIN=YOURCALL
#                            everything: stack + real P.533 WASM engine
#   make p533                build the P.533 engine and deploy it
#   make down / logs / ps    the usual
#   make prod-up              start the prod stack from published GHCR images
#                              (needs .env — see .env.example)
#
# DXSPIDER_LOGIN is the callsign used to log into the DX Spider node.

DXSPIDER_LOGIN ?= N0CALL
COMPOSE        := docker compose
PROD_COMPOSE   := docker compose -f docker-compose.prod.yml
IONOS_VOLUME   := skywave-ionos-data
IONOS_SRC      := p533-wasm/vendor/ITU-R-HF/P533/Data

.PHONY: all up down build rebuild logs ps p533 wasm ionos-load frontend clean distclean \
  prod-up prod-down prod-pull prod-logs prod-ps

## Full install: stack + real P.533 engine
all: up p533

## Start (or update) the whole stack — dashboard on :80
up:
	DXSPIDER_LOGIN=$(DXSPIDER_LOGIN) $(COMPOSE) up -d --build

down:
	$(COMPOSE) down

## Rebuild images without starting
build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

## Build the P.533 WASM engine and deploy it into the running stack:
## compile → load monthly ionos data into the volume → rebuild frontend
p533: wasm ionos-load frontend
	@echo "P.533 engine deployed — the Propagation panel badge now reads P.533."

## Compile ITU-R P.533 + P372 to WASM (requires Docker; clones ITU-R-HF)
wasm:
	cd p533-wasm && ./build.sh

## Copy the 12 monthly ionosNN.bin files (~134 MB) into the ionos volume.
## Uses a helper container because frontend mounts the volume read-only.
ionos-load:
	@test -d $(IONOS_SRC) || { echo "run 'make wasm' first (clones the data files)"; exit 1; }
	docker run --rm \
	  -v $(IONOS_VOLUME):/dst \
	  -v $(PWD)/$(IONOS_SRC):/src:ro \
	  alpine:3 sh -c 'cp /src/ionos*.bin /dst/ && ls /dst | wc -l'

## Rebuild + redeploy just the frontend (picks up freshly built WASM artifacts)
frontend:
	$(COMPOSE) build frontend
	DXSPIDER_LOGIN=$(DXSPIDER_LOGIN) $(COMPOSE) up -d frontend

## Stop the stack and remove built images (keeps volumes/data)
clean: down
	$(COMPOSE) down --rmi local

## Also remove volumes (cached ionos data, redis cache) and WASM build output
distclean:
	$(COMPOSE) down --rmi local --volumes
	rm -rf p533-wasm/dist p533-wasm/vendor \
	  frontend/public/p533 frontend/public/coeff

## Production: pull the published multi-arch images and (re)start the stack
prod-up:
	$(PROD_COMPOSE) pull
	$(PROD_COMPOSE) up -d

prod-down:
	$(PROD_COMPOSE) down

prod-pull:
	$(PROD_COMPOSE) pull

prod-logs:
	$(PROD_COMPOSE) logs -f --tail=100

prod-ps:
	$(PROD_COMPOSE) ps
