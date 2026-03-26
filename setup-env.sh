#!/usr/bin/env bash
# =============================================================================
# Chess Arena – Environment Setup Script
# =============================================================================
# Usage:
#   ./setup-env.sh                        # interactive prompts
#   ./setup-env.sh \
#     --supabase-url          "https://xxx.supabase.co" \
#     --supabase-service-key  "your-service-key" \
#     --midtrans-server-key   "Mid-server-xxx" \
#     --midtrans-client-key   "Mid-client-xxx" \
#     --jwt-secret            "super-secret" \
#     --frontend-url          "https://chess-app.vercel.app" \
#     --allowed-origins       "https://chess-app.vercel.app" \
#     --next-public-midtrans-client-key "Mid-client-xxx"
# =============================================================================

set -euo pipefail

VERCEL="$HOME/.nvm/versions/node/v24.14.0/bin/vercel"
BACKEND_DIR="$(cd "$(dirname "$0")/chess-backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/chess-app" && pwd)"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[0;36m[INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[0;32m[ OK ]\033[0m  %s\n' "$*"; }
err()   { printf '\033[0;31m[ERR ]\033[0m  %s\n' "$*" >&2; }

prompt_var() {
    local var_name="$1"
    local description="$2"
    local current_val="$3"
    if [[ -n "$current_val" ]]; then
        echo "$current_val"
        return
    fi
    local input
    read -r -p "  $var_name ($description): " input
    echo "$input"
}

add_env() {
    local project_dir="$1"
    local name="$2"
    local value="$3"
    info "Setting $name in $(basename "$project_dir") …"
    # Remove existing value silently (ignore errors), then add fresh
    (cd "$project_dir" && echo "$value" | "$VERCEL" env rm "$name" production --yes 2>/dev/null || true)
    (cd "$project_dir" && printf '%s' "$value" | "$VERCEL" env add "$name" production)
    ok "$name set."
}

# -----------------------------------------------------------------------------
# Parse CLI arguments
# -----------------------------------------------------------------------------
ARG_SUPABASE_URL=""
ARG_SUPABASE_SERVICE_KEY=""
ARG_MIDTRANS_SERVER_KEY=""
ARG_MIDTRANS_CLIENT_KEY=""
ARG_JWT_SECRET=""
ARG_FRONTEND_URL=""
ARG_ALLOWED_ORIGINS=""
ARG_NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --supabase-url)                    ARG_SUPABASE_URL="$2";                    shift 2 ;;
        --supabase-service-key)            ARG_SUPABASE_SERVICE_KEY="$2";            shift 2 ;;
        --midtrans-server-key)             ARG_MIDTRANS_SERVER_KEY="$2";             shift 2 ;;
        --midtrans-client-key)             ARG_MIDTRANS_CLIENT_KEY="$2";             shift 2 ;;
        --jwt-secret)                      ARG_JWT_SECRET="$2";                      shift 2 ;;
        --frontend-url)                    ARG_FRONTEND_URL="$2";                    shift 2 ;;
        --allowed-origins)                 ARG_ALLOWED_ORIGINS="$2";                 shift 2 ;;
        --next-public-midtrans-client-key) ARG_NEXT_PUBLIC_MIDTRANS_CLIENT_KEY="$2"; shift 2 ;;
        *) err "Unknown argument: $1"; exit 1 ;;
    esac
done

# -----------------------------------------------------------------------------
# Collect values
# -----------------------------------------------------------------------------
bold ""
bold "=== Chess Arena – Vercel Environment Setup ==="
bold ""
info "Backend directory : $BACKEND_DIR"
info "Frontend directory: $FRONTEND_DIR"
info "Vercel CLI        : $VERCEL"
echo ""

if [[ ! -x "$VERCEL" ]]; then
    err "Vercel CLI not found or not executable at: $VERCEL"
    exit 1
fi

bold "--- chess-backend variables ---"
SUPABASE_URL=$(prompt_var          "SUPABASE_URL"         "e.g. https://xxx.supabase.co"      "$ARG_SUPABASE_URL")
SUPABASE_SERVICE_KEY=$(prompt_var  "SUPABASE_SERVICE_KEY" "Supabase service-role key"         "$ARG_SUPABASE_SERVICE_KEY")
MIDTRANS_SERVER_KEY=$(prompt_var   "MIDTRANS_SERVER_KEY"  "Midtrans server key"               "$ARG_MIDTRANS_SERVER_KEY")
MIDTRANS_CLIENT_KEY=$(prompt_var   "MIDTRANS_CLIENT_KEY"  "Midtrans client key"               "$ARG_MIDTRANS_CLIENT_KEY")
JWT_SECRET=$(prompt_var            "JWT_SECRET"           "Random secret string"              "$ARG_JWT_SECRET")
FRONTEND_URL=$(prompt_var          "FRONTEND_URL"         "e.g. https://chess-app.vercel.app" "$ARG_FRONTEND_URL")
ALLOWED_ORIGINS=$(prompt_var       "ALLOWED_ORIGINS"      "Comma-separated origins"           "$ARG_ALLOWED_ORIGINS")

bold ""
bold "--- chess-app variables ---"
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=$(prompt_var \
    "NEXT_PUBLIC_MIDTRANS_CLIENT_KEY" \
    "Same as MIDTRANS_CLIENT_KEY" \
    "$ARG_NEXT_PUBLIC_MIDTRANS_CLIENT_KEY")

# Validate nothing is empty
for pair in \
    "SUPABASE_URL:$SUPABASE_URL" \
    "SUPABASE_SERVICE_KEY:$SUPABASE_SERVICE_KEY" \
    "MIDTRANS_SERVER_KEY:$MIDTRANS_SERVER_KEY" \
    "MIDTRANS_CLIENT_KEY:$MIDTRANS_CLIENT_KEY" \
    "JWT_SECRET:$JWT_SECRET" \
    "FRONTEND_URL:$FRONTEND_URL" \
    "ALLOWED_ORIGINS:$ALLOWED_ORIGINS" \
    "NEXT_PUBLIC_MIDTRANS_CLIENT_KEY:$NEXT_PUBLIC_MIDTRANS_CLIENT_KEY"
do
    key="${pair%%:*}"
    val="${pair#*:}"
    if [[ -z "$val" ]]; then
        err "$key must not be empty."
        exit 1
    fi
done

# -----------------------------------------------------------------------------
# Push variables to Vercel – chess-backend
# -----------------------------------------------------------------------------
bold ""
bold "=== Pushing variables to chess-backend ==="

add_env "$BACKEND_DIR" "SUPABASE_URL"        "$SUPABASE_URL"
add_env "$BACKEND_DIR" "SUPABASE_SERVICE_KEY" "$SUPABASE_SERVICE_KEY"
add_env "$BACKEND_DIR" "MIDTRANS_SERVER_KEY"  "$MIDTRANS_SERVER_KEY"
add_env "$BACKEND_DIR" "MIDTRANS_CLIENT_KEY"  "$MIDTRANS_CLIENT_KEY"
add_env "$BACKEND_DIR" "JWT_SECRET"           "$JWT_SECRET"
add_env "$BACKEND_DIR" "FRONTEND_URL"         "$FRONTEND_URL"
add_env "$BACKEND_DIR" "ALLOWED_ORIGINS"      "$ALLOWED_ORIGINS"
add_env "$BACKEND_DIR" "NODE_ENV"             "production"

# -----------------------------------------------------------------------------
# Push variables to Vercel – chess-app
# -----------------------------------------------------------------------------
bold ""
bold "=== Pushing variables to chess-app ==="

add_env "$FRONTEND_DIR" "NEXT_PUBLIC_MIDTRANS_CLIENT_KEY" "$NEXT_PUBLIC_MIDTRANS_CLIENT_KEY"

# -----------------------------------------------------------------------------
# Redeploy both projects
# -----------------------------------------------------------------------------
bold ""
bold "=== Redeploying chess-backend ==="
(cd "$BACKEND_DIR"  && "$VERCEL" --prod --yes)
ok "chess-backend redeployed."

bold ""
bold "=== Redeploying chess-app ==="
(cd "$FRONTEND_DIR" && "$VERCEL" --prod --yes)
ok "chess-app redeployed."

bold ""
bold "=== All done! Both projects have been configured and redeployed. ==="
