#!/usr/bin/env bash
# Sends one Pushover notification (https://pushover.net/api).
#
#   push.sh [options] <message>      the message as arguments, or "-" to read stdin
#   push.sh --check                  validates the keys, sends nothing
#
#   -t, --title TEXT       up to 250 characters (default: the application's name)
#   -p, --priority N       -2 no alert, -1 quiet, 0 normal (default), 1 high
#                          (bypasses quiet hours), 2 emergency (repeats until
#                          acknowledged)
#   -u, --url URL          a link under the message, up to 512 characters
#       --url-title TEXT   its label, up to 100 characters
#   -s, --sound NAME       pushover, bike, bugle, ..., none (default: the user's)
#   -d, --device NAME      one device instead of all
#       --html | --mono    render HTML tags, or monospace
#       --ttl SECONDS      the notification deletes itself after this long
#       --retry SECONDS    priority 2: repeat this often (default 60, at least 30)
#       --expire SECONDS   priority 2: give up after (default 600, at most 10800)
#
# Keys: PUSHOVER_TOKEN (the application's API token) and PUSHOVER_USER (the
# user or group key), from the environment, else from the first .env that has
# them: $PUSHOVER_ENV, this checkout's root, the main checkout's root (so git
# worktrees share the main checkout's file). The keys and the message go to
# curl on stdin, never on a command line.
#
# Exit: 0 sent · 2 bad usage or input over a limit · 3 keys missing or
# malformed · 4 Pushover refused it (4xx: fix the input, a repeat fails the
# same way) · 5 no answer or a server error, after one retry.

set -uo pipefail

api=${PUSHOVER_API:-https://api.pushover.net/1}
title="" priority=0 url="" url_title="" sound="" device="" format="" ttl="" retry=60 expire=600 check=0

die() { echo "push: $2" >&2; exit "$1"; }
need() { [ $# -ge 2 ] || die 2 "$1 needs a value"; }

while [ $# -gt 0 ]; do
  case $1 in
    -t|--title) need "$@"; title=$2; shift 2 ;;
    -p|--priority) need "$@"; priority=$2; shift 2 ;;
    -u|--url) need "$@"; url=$2; shift 2 ;;
    --url-title) need "$@"; url_title=$2; shift 2 ;;
    -s|--sound) need "$@"; sound=$2; shift 2 ;;
    -d|--device) need "$@"; device=$2; shift 2 ;;
    --html) format=html; shift ;;
    --mono) format=monospace; shift ;;
    --ttl) need "$@"; ttl=$2; shift 2 ;;
    --retry) need "$@"; retry=$2; shift 2 ;;
    --expire) need "$@"; expire=$2; shift 2 ;;
    --check) check=1; shift ;;
    -h|--help) sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    --) shift; break ;;
    -) break ;;
    -[0-9]*) break ;;
    -*) die 2 "unknown option $1 (--help lists them)" ;;
    *) break ;;
  esac
done

# ---- the keys

here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)
main=$(git -C "$here" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')

# NAME FILE: the value of the file's last NAME= line, quotes and trailing space off.
read_key() {
  [ -f "$2" ] || return 0
  sed -En "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*//p" "$2" | tail -n 1 |
    tr -d '\r' | sed -E "s/[[:space:]]+$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}
find_key() {
  local name=$1 value=${!1:-} file
  for file in "${PUSHOVER_ENV:-}" "${root:+$root/.env}" "${main:+$main/.env}"; do
    [ -n "$value" ] && break
    [ -n "$file" ] && value=$(read_key "$name" "$file")
  done
  printf '%s' "$value"
}

token=$(find_key PUSHOVER_TOKEN)
user=$(find_key PUSHOVER_USER)
env_file=${PUSHOVER_ENV:-${main:-${root:-.}}/.env}
missing=""
[ -n "$token" ] || missing="PUSHOVER_TOKEN"
[ -n "$user" ] || missing="${missing:+$missing and }PUSHOVER_USER"
[ -z "$missing" ] || die 3 "$missing not set: add to $env_file"
[[ $token =~ ^[A-Za-z0-9]{30}$ ]] || die 3 "PUSHOVER_TOKEN isn't 30 letters and digits: check $env_file"
[[ $user =~ ^[A-Za-z0-9]{30}(,[A-Za-z0-9]{30})*$ ]] || die 3 "PUSHOVER_USER isn't a 30 character key: check $env_file"

# ---- the request

# A value inside a quoted curl config string.
esc() {
  local s=$1
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}
  printf '%s' "$s"
}
config=""
field() { config+="form-string = \"$1=$(esc "$2")\""$'\n'; }
field token "$token"
field user "$user"

if [ "$check" = 1 ]; then
  endpoint=users/validate.json
  [ -z "$device" ] || field device "$device"
else
  endpoint=messages.json
  if [ "${1:-}" = "-" ]; then message=$(cat); else message="$*"; fi
  [ -n "$message" ] || die 2 "no message (push.sh [options] <message>)"
  [ ${#message} -le 1024 ] || die 2 "the message has ${#message} characters, Pushover takes 1024: shorten it"
  [ ${#title} -le 250 ] || die 2 "the title has ${#title} characters, Pushover takes 250"
  [ ${#url} -le 512 ] || die 2 "the url has ${#url} characters, Pushover takes 512"
  [ ${#url_title} -le 100 ] || die 2 "the url title has ${#url_title} characters, Pushover takes 100"
  case $priority in -2|-1|0|1|2) ;; *) die 2 "priority is -2, -1, 0, 1 or 2" ;; esac
  field message "$message"
  field priority "$priority"
  [ -z "$title" ] || field title "$title"
  [ -z "$url" ] || field url "$url"
  [ -z "$url_title" ] || field url_title "$url_title"
  [ -z "$sound" ] || field sound "$sound"
  [ -z "$device" ] || field device "$device"
  [ -z "$format" ] || field "$format" 1
  [ -z "$ttl" ] || field ttl "$ttl"
  if [ "$priority" = 2 ]; then
    [[ $retry =~ ^[0-9]+$ ]] && [ "$retry" -ge 30 ] || die 2 "--retry is at least 30 seconds"
    [[ $expire =~ ^[0-9]+$ ]] && [ "$expire" -le 10800 ] || die 2 "--expire is at most 10800 seconds"
    field retry "$retry"
    field expire "$expire"
  fi
fi

body=$(mktemp "${TMPDIR:-/tmp}/pushover.XXXXXX") || die 5 "no temp file"
trap 'rm -f "$body"' EXIT
json() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$body" | head -n 1; }

# Pushover: a 4xx fails the same way again; anything else is temporary and is
# retried no sooner than 5 seconds later.
for attempt in 1 2; do
  code=$(printf '%s' "$config" | curl -sS --max-time 20 -o "$body" -w '%{http_code}' --config - "$api/$endpoint" 2>"$body.err") || code=000
  case $code in
    200) grep -q '"status":1' "$body" && break
         code=400 ;;
  esac
  case $code in
    4??) break ;;
  esac
  [ "$attempt" = 1 ] && sleep "${PUSHOVER_RETRY_WAIT:-5}"
done
err=$(cat "$body.err" 2>/dev/null); rm -f "$body.err"

case $code in
  200)
    if [ "$check" = 1 ]; then
      echo "keys valid (devices: $(sed -n 's/.*"devices":\[\([^]]*\)\].*/\1/p' "$body" | tr -d '"'))"
    else
      receipt=$(json receipt)
      echo "sent (request $(json request)${receipt:+, receipt $receipt})"
    fi ;;
  429) die 4 "Pushover's monthly message quota is used up (HTTP 429)" ;;
  4??)
    reasons=$(sed -n 's/.*"errors":\[\([^]]*\)\].*/\1/p' "$body" | tr -d '"')
    die 4 "Pushover refused it (HTTP $code): ${reasons:-$(head -c 300 "$body")}" ;;
  *) die 5 "no answer from Pushover (HTTP $code${err:+, $err}), tried twice" ;;
esac
