#!/bin/sh
# docker-entrypoint.sh
# Chooses between production (pre-built) and dev (hot-reload) startup.

set -e

if [ "${NEXT_MODE}" = "dev" ]; then
  echo "[frontend] Starting in DEV mode (npm run dev)"
  exec npm run dev
else
  echo "[frontend] Starting in PRODUCTION mode (npm start)"
  exec npm start
fi
