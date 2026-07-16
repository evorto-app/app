#!/bin/sh
set -eu

# Docker-only helper: capture the Stripe CLI webhook signing secret into a
# shared file so the app container can verify local webhook replay requests.
secret_file=/run/stripe-webhook/signing-secret

rm -f "$secret_file"

log_pipe="$(mktemp -u /tmp/stripe-listen.XXXXXX)"
mkfifo "$log_pipe"

while IFS= read -r line; do
  secret="$(printf '%s\n' "$line" | sed -n 's/.*\(whsec_[A-Za-z0-9_]*\).*/\1/p' | head -n 1)"
  if [ -n "$secret" ]; then
    printf '%s\n' "$line" | sed 's/whsec_[A-Za-z0-9_]*/whsec_[REDACTED]/g'
    printf '%s' "$secret" > "$secret_file"
    chmod 0444 "$secret_file"
  else
    printf '%s\n' "$line"
  fi
done < "$log_pipe" &
reader_pid="$!"
stripe_pid=''

cleanup() {
  signal="$1"
  status="$2"
  trap - HUP INT TERM
  if [ -n "$stripe_pid" ]; then
    kill -"$signal" "$stripe_pid" 2>/dev/null || true
    wait "$stripe_pid" 2>/dev/null || true
  fi
  kill -"$signal" "$reader_pid" 2>/dev/null || true
  wait "$reader_pid" 2>/dev/null || true
  rm -f "$log_pipe"
  exit "$status"
}

trap 'cleanup HUP 129' HUP
trap 'cleanup INT 130' INT
trap 'cleanup TERM 143' TERM

set +e
stripe listen --forward-to http://evorto:4200/webhooks/stripe > "$log_pipe" 2>&1 &
stripe_pid="$!"
wait "$stripe_pid"
stripe_status="$?"
stripe_pid=''
wait "$reader_pid"
reader_status="$?"
set -e
rm -f "$log_pipe"
if [ "$stripe_status" -ne 0 ]; then
  exit "$stripe_status"
fi
exit "$reader_status"
