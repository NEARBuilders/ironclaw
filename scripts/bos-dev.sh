#!/usr/bin/env bash
# Launch IronClaw Reborn with the everything-dev BOS toolchain.
#
#   --local           starts the everything-dev dev stack locally.
#   <account>/<gateway>  starts a production-like host against a remote gateway.
#
# Usage:
#   scripts/bos-dev.sh --local                                # local everything-dev stack
#   scripts/bos-dev.sh work.efiz.near/ironclaw.everything.dev  # remote gateway
#
# Before running, export your provider's API key, e.g.:
#   export NEARAI_API_KEY=...      # or OPENAI_API_KEY / ANTHROPIC_API_KEY
#
# Overridable via environment:
#   PROVIDER      provider id        (default: nearai)
#   MODEL         model id           (default: $NEARAI_MODEL)
#   REBORN_HOST   listen host        (default: 127.0.0.1)
#   REBORN_PORT   listen port        (default: 3001)
#   IRONCLAW_REBORN_HOME             (default: $HOME/.ironclaw-reborn-demo)
#   IRONCLAW_REBORN_WEBUI_USER_ID    (default: home's [identity].default_owner)
#   IRONCLAW_REBORN_WEBUI_TOKEN      (default: auto-generated random token)
#   NEARAI_MODEL                     (default: deepseek-ai/DeepSeek-V4-Flash)
#   NEARAI_BASE_URL                  (default: https://cloud-api.near.ai)
#   IRONCLAW_REBORN_PROFILE          (default: local-dev-yolo)
#   IRONCLAW_REBORN_LOG              (default: info)
#   IRONCLAW_TRIGGER_POLLER_ENABLED  (default: true)

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

PROVIDER="${PROVIDER:-nearai}"
MODEL="${MODEL:-}"
REBORN_HOST="${REBORN_HOST:-127.0.0.1}"
REBORN_PORT="${REBORN_PORT:-3001}"
NEARAI_MODEL="${NEARAI_MODEL:-deepseek-ai/DeepSeek-V4-Flash}"
NEARAI_BASE_URL="${NEARAI_BASE_URL:-https://cloud-api.near.ai}"
IRONCLAW_REBORN_PROFILE="${IRONCLAW_REBORN_PROFILE:-local-dev-yolo}"
IRONCLAW_REBORN_LOG="${IRONCLAW_REBORN_LOG:-info}"
IRONCLAW_TRIGGER_POLLER_ENABLED="${IRONCLAW_TRIGGER_POLLER_ENABLED:-true}"

ARG="${1:-}"
if [ "$ARG" = "--local" ]; then
  MODE="local"
elif [[ "$ARG" =~ ^[a-z0-9_.-]+/[a-z0-9_.-]+$ ]]; then
  MODE="remote"
  ACCOUNT="${ARG%%/*}"
  DOMAIN="${ARG#*/}"
else
  echo "Usage: $0 [--local | <account>/<gateway>]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  $0 --local                                           # Local everything-dev stack" >&2
  echo "  $0 work.efiz.near/ironclaw.everything.dev          # Remote gateway" >&2
  exit 1
fi

stale_pid="$(lsof -ti "tcp:$REBORN_PORT" -c ironclaw-reborn 2>/dev/null || true)"
if [ -n "$stale_pid" ]; then
  echo "==> Killing stale ironclaw-reborn (PID $stale_pid) on port $REBORN_PORT"
  kill "$stale_pid" 2>/dev/null || true
  sleep 1
fi

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

export IRONCLAW_REBORN_HOME="${IRONCLAW_REBORN_HOME:-$HOME/.ironclaw-reborn-demo}"

case "$IRONCLAW_REBORN_HOME" in
  /*) home_abs="$IRONCLAW_REBORN_HOME" ;;
  *)  home_abs="$PWD/$IRONCLAW_REBORN_HOME" ;;
esac
home_parent="$(cd "$(dirname "$home_abs")" 2>/dev/null && pwd -P || true)"
repo_canonical="$(cd "$REPO_ROOT" && pwd -P)"
if [ -n "$home_parent" ]; then
  home_canonical="$home_parent/$(basename "$home_abs")"
  case "$home_canonical/" in
    "$repo_canonical"/*)
      echo "error: IRONCLAW_REBORN_HOME ($home_canonical) is inside the repo ($repo_canonical)." >&2
      echo "       serve uses the cwd as the workspace root and rejects overlap." >&2
      echo "       Point it somewhere else, e.g. \$HOME/.ironclaw-reborn-demo." >&2
      exit 1
      ;;
  esac
fi

export IRONCLAW_UNSAFE_RAW_HTTP_EGRESS_ERRORS=1
export IRONCLAW_REBORN_LOG
export IRONCLAW_REBORN_PROFILE
export IRONCLAW_TRIGGER_POLLER_ENABLED
export NEARAI_BASE_URL
export NEARAI_MODEL

if [ -z "${IRONCLAW_REBORN_WEBUI_TOKEN:-}" ]; then
  if command -v openssl &>/dev/null; then
    IRONCLAW_REBORN_WEBUI_TOKEN="$(openssl rand -hex 32)"
  else
    IRONCLAW_REBORN_WEBUI_TOKEN="local-dev-token"
  fi
fi
export IRONCLAW_REBORN_WEBUI_TOKEN

key_env=""
if [ "$PROVIDER" = "nearai" ]; then
  key_env="NEARAI_API_KEY"
elif [ "$PROVIDER" = "openai" ]; then
  key_env="OPENAI_API_KEY"
elif [ "$PROVIDER" = "anthropic" ]; then
  key_env="ANTHROPIC_API_KEY"
fi

if [ -n "$key_env" ] && [ -z "${!key_env:-}" ]; then
  echo "==> $key_env is not set."
  read -r -p "    Enter your $PROVIDER API key (or press Enter to skip and set it later): " api_key
  if [ -n "$api_key" ]; then
    export "$key_env=$api_key"
  else
    echo "    warning: no key provided. Turns will fail until you export $key_env." >&2
  fi
fi

CARGO=(cargo run -p ironclaw_reborn_cli --features webui-v2-beta --)

set_provider_args=(models set-provider "$PROVIDER")
if [ -n "$MODEL" ]; then
  set_provider_args+=(--model "$MODEL")
fi
echo "==> Configuring model route: provider=$PROVIDER ${MODEL:+model=$MODEL}"
"${CARGO[@]}" "${set_provider_args[@]}"

config_file="$IRONCLAW_REBORN_HOME/config.toml"
config_owner=""
if [ -f "$config_file" ]; then
  config_owner="$(sed -n 's/^[[:space:]]*default_owner[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$config_file" | head -1)"
fi
export IRONCLAW_REBORN_WEBUI_USER_ID="${IRONCLAW_REBORN_WEBUI_USER_ID:-${config_owner:-reborn-cli}}"

key_env="$("${CARGO[@]}" models status 2>/dev/null \
  | sed -n 's/^default\.api_key_env: //p' || true)"
if [ -n "$key_env" ] && [ -z "${!key_env:-}" ]; then
  echo "warning: $key_env is not set. Required-key providers (openai, anthropic, …)" >&2
  echo "         fail at startup; export it before turns will work." >&2
fi

cleanup() {
  echo ""
  echo "Shutting down..."
  if [ -n "${REBORN_PID:-}" ]; then
    kill "$REBORN_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup SIGINT SIGTERM

# ─────────────────────────────────────────────────────────────────────
# Local mode — start Reborn + everything-dev dev stack on localhost
# ─────────────────────────────────────────────────────────────────────
if [ "$MODE" = "local" ]; then
  EVDEV_DIR="$REPO_ROOT/app/ironclaw.everything.dev"

  if [ ! -d "$EVDEV_DIR" ]; then
    echo "error: everything-dev project not found at $EVDEV_DIR" >&2
    exit 1
  fi

  if [ ! -f "$EVDEV_DIR/.env" ]; then
    echo "error: $EVDEV_DIR/.env not found." >&2
    echo "       Run 'cp .env.example .env' in that directory and configure it." >&2
    exit 1
  fi

  if [ ! -f "$EVDEV_DIR/node_modules/.bin/bos" ]; then
    echo "error: everything-dev dependencies not installed." >&2
    echo "       Run 'bun install' in $EVDEV_DIR" >&2
    exit 1
  fi

  export IRONCLAW_BASE_URL="http://$REBORN_HOST:$REBORN_PORT"
  export IRONCLAW_API_TOKEN="$IRONCLAW_REBORN_WEBUI_TOKEN"
  export IRONCLAW_REBORN_CORS_ORIGINS="http://localhost:3000"

  echo "==> Starting ironclaw-reborn on http://$REBORN_HOST:$REBORN_PORT"
  "${CARGO[@]}" serve --confirm-host-access --host "$REBORN_HOST" --port "$REBORN_PORT" &
  REBORN_PID=$!
  sleep 1

  cat << BANNER

══════════════════════════════════════════════════════════════════
 IronClaw Reborn — MODE: LOCAL
══════════════════════════════════════════════════════════════════
 The ironclaw plugin auto-discovers Reborn via IRONCLAW_BASE_URL.
 No settings configuration needed — just open the UI.

  ┌─ Open ───────────────────────────────────────────────────┐
  │                                                          │
  │    http://localhost:3000                                  │
  │                                                          │
  │  The sidebar shows (●) Connected when ready.             │
  └──────────────────────────────────────────────────────────┘

  API        : http://$REBORN_HOST:$REBORN_PORT
  Token      : $IRONCLAW_REBORN_WEBUI_TOKEN
  Reborn home: $IRONCLAW_REBORN_HOME

  Press Ctrl+C to stop

BANNER

  echo "==> Starting everything-dev dev stack..."
  cd "$EVDEV_DIR"
  bun run dev || true
  cleanup
fi

# ─────────────────────────────────────────────────────────────────────
# Remote mode — start Reborn + bos start against a remote gateway
# ─────────────────────────────────────────────────────────────────────
if [ "$MODE" = "remote" ]; then
  EVDEV_DIR="$REPO_ROOT/app/ironclaw.everything.dev"

  if [ ! -d "$EVDEV_DIR" ]; then
    echo "error: everything-dev project not found at $EVDEV_DIR" >&2
    exit 1
  fi

  if [ ! -f "$EVDEV_DIR/node_modules/.bin/bos" ]; then
    echo "error: everything-dev dependencies not installed." >&2
    echo "       Run 'bun install' in $EVDEV_DIR" >&2
    exit 1
  fi

  export IRONCLAW_BASE_URL="http://$REBORN_HOST:$REBORN_PORT"
  export IRONCLAW_API_TOKEN="$IRONCLAW_REBORN_WEBUI_TOKEN"
  export IRONCLAW_REBORN_CORS_ORIGINS="http://localhost:3000"

  echo "==> Starting ironclaw-reborn on http://$REBORN_HOST:$REBORN_PORT"
  "${CARGO[@]}" serve --confirm-host-access --host "$REBORN_HOST" --port "$REBORN_PORT" &
  REBORN_PID=$!
  sleep 1

  cat << BANNER

══════════════════════════════════════════════════════════════════
 IronClaw Reborn — MODE: REMOTE GATEWAY
══════════════════════════════════════════════════════════════════
 Running local Reborn with the everything-dev host configured
 for the remote gateway. The ironclaw plugin loads from the
 published deployment and connects to your local Reborn.

  Account      : $ACCOUNT
  Gateway      : $DOMAIN
  API          : http://$REBORN_HOST:$REBORN_PORT
  Token        : $IRONCLAW_REBORN_WEBUI_TOKEN
  Reborn home  : $IRONCLAW_REBORN_HOME

  The everything-dev host prints its local URL when ready.
  Check 'bos status' or the host output for the exact port.

  Press Ctrl+C to stop

BANNER

  echo "==> Starting everything-dev host against $ACCOUNT/$DOMAIN..."
  cd "$EVDEV_DIR"
  bun run start -- --account "$ACCOUNT" --domain "$DOMAIN" || true
  cleanup
fi
