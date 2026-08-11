#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# SPINOR OS — Programming as Deployment
# 
# One command. The code runs. That's the deployment.
#
#   ./deploy.sh          → build + run on http://localhost:7860
#   ./deploy.sh dev      → dev mode on http://localhost:3000
#   ./deploy.sh docker   → build + run Docker container
#   ./deploy.sh stop     → stop running instance
#   ./deploy.sh status   → check if running
# ─────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

PORT="${PORT:-7860}"
CONTAINER_NAME="spinor-os"
PID_FILE=".spinor-os.pid"
LOG_FILE=".spinor-os.log"

case "${1:-run}" in

  # ── Dev mode: hot reload, no build ────────────────────────────
  dev)
    echo "▶ SPINOR OS — dev mode on :3000"
    PORT=3000 npm run dev
    ;;

  # ── Docker: build image + run container ───────────────────────
  docker)
    echo "▶ SPINOR OS — Docker build on :$PORT"
    docker build -t spinor-os .
    echo "▶ Starting container on :$PORT"
    docker run -d --rm \
      --name "$CONTAINER_NAME" \
      -p "$PORT:7860" \
      -v "$(pwd)/data:/app/data" \
      spinor-os
    echo "✓ Live at http://localhost:$PORT"
    echo "  Logs: docker logs -f $CONTAINER_NAME"
    echo "  Stop: docker stop $CONTAINER_NAME"
    ;;

  # ── Run: build + start production server ──────────────────────
  run|"")
    # Check if already running
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
      echo "✓ Already running (PID $(cat $PID_FILE)) at http://localhost:$PORT"
      echo "  Stop: ./deploy.sh stop"
      exit 0
    fi

    echo "▶ Building SPINOR OS..."
    NEXT_PUBLIC_DEMO=true npm run build 2>&1 | tail -5 || true
    # Verify the standalone build exists
    if [ ! -f ".next/standalone/server.js" ]; then
      echo "✗ Build failed — standalone server.js not found"
      exit 1
    fi

    echo ""
    echo "▶ Starting production server on :$PORT..."
    NEXT_PUBLIC_DEMO=true PORT="$PORT" node .next/standalone/server.js &
    PID=$!
    echo $PID > "$PID_FILE"

    # Wait for server to be ready
    for i in $(seq 1 30); do
      if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
        echo ""
        echo "✓ SPINOR OS is live at http://localhost:$PORT"
        echo "  PID: $PID"
        echo "  Logs: tail -f $LOG_FILE"
        echo "  Stop: ./deploy.sh stop"
        echo ""
        echo "  Pages:"
        echo "    http://localhost:$PORT/today"
        echo "    http://localhost:$PORT/foundry"
        echo "    http://localhost:$PORT/spin-lifecycle"
        echo "    http://localhost:$PORT/etl"
        echo "    http://localhost:$PORT/golden-nodes"
        exit 0
      fi
      sleep 1
    done

    echo "✗ Server didn't start in 30s — check $LOG_FILE"
    exit 1
    ;;

  # ── Stop: kill running instance ───────────────────────────────
  stop)
    # Stop native process
    if [ -f "$PID_FILE" ]; then
      PID="$(cat $PID_FILE)"
      if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        echo "✓ Stopped SPINOR OS (PID $PID)"
      fi
      rm -f "$PID_FILE"
    fi
    # Stop Docker container
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
      docker stop "$CONTAINER_NAME" >/dev/null
      echo "✓ Stopped Docker container $CONTAINER_NAME"
    fi
    ;;

  # ── Status: check if running ──────────────────────────────────
  status)
    # Check native
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
      PID="$(cat $PID_FILE)"
      HEALTH=$(curl -sf "http://localhost:$PORT/api/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "unreachable")
      echo "✓ Running (PID $PID) on :$PORT — health: $HEALTH"
      exit 0
    fi
    # Check Docker
    if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
      echo "✓ Running in Docker container on :$PORT"
      exit 0
    fi
    echo "✗ Not running"
    exit 1
    ;;

  # ── Health: check the live endpoint ───────────────────────────
  health)
    curl -s "http://localhost:$PORT/api/health" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'Status: {d.get(\"status\",\"?\")}')
spin=d.get('checks',{}).get('spinEngine',{})
print(f'SPIN: {spin.get(\"detail\",\"?\")}')
llm=d.get('checks',{}).get('llm',{})
print(f'LLM: {llm.get(\"detail\",llm.get(\"status\",\"?\"))}')
" 2>/dev/null || echo "✗ Server not reachable on :$PORT"
    ;;

  *)
    echo "Usage: ./deploy.sh [dev|docker|run|stop|status|health]"
    echo ""
    echo "  run (default)  Build + start production server on :7860"
    echo "  dev            Start dev server with hot reload on :3000"
    echo "  docker         Build Docker image + run container on :7860"
    echo "  stop           Stop running instance"
    echo "  status         Check if running"
    echo "  health         Check health endpoint"
    exit 1
    ;;

esac
