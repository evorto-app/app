#!/bin/sh
set -eu

# Docker-only helper: capture the Stripe CLI webhook signing secret into a
# shared file so the app container can verify local webhook replay requests.
secret_file=/run/stripe-webhook/signing-secret

rm -f "$secret_file"

log_pipe="$(mktemp -u /tmp/stripe-listen.XXXXXX)"
mkfifo "$log_pipe"

while IFS= read -r line; do
  echo "$line"
  secret="$(printf '%s\n' "$line" | sed -n 's/.*\(whsec_[A-Za-z0-9_]*\).*/\1/p' | head -n 1)"
  if [ -n "$secret" ]; then
    printf '%s' "$secret" > "$secret_file"
    chmod 0444 "$secret_file"
  fi
done < "$log_pipe" &
reader_pid="$!"

set +e
stripe listen --forward-to http://evorto:4200/webhooks/stripe > "$log_pipe" 2>&1
stripe_status="$?"
wait "$reader_pid"
reader_status="$?"
set -e
rm -f "$log_pipe"
if [ "$stripe_status" -ne 0 ]; then
  exit "$stripe_status"
fi
exit "$reader_status"
