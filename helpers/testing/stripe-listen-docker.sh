#!/bin/sh
set -eu

secret_file=/run/stripe-webhook/signing-secret

rm -f "$secret_file"

stripe listen --forward-to http://evorto:4200/webhooks/stripe 2>&1 | while IFS= read -r line; do
  echo "$line"
  secret="$(printf '%s\n' "$line" | sed -n 's/.*\(whsec_[A-Za-z0-9_]*\).*/\1/p' | head -n 1)"
  if [ -n "$secret" ]; then
    printf '%s' "$secret" > "$secret_file"
    chmod 0444 "$secret_file"
  fi
done
