#!/bin/sh
# Runs the whole suite under several time zones. Uso: sh pruebas/run.sh
cd "$(dirname "$0")"
for tz in America/Argentina/Buenos_Aires America/New_York America/Santiago America/Sao_Paulo UTC; do
  echo "=================== TZ=$tz"
  TZ=$tz node --test --test-reporter=spec money.test.js calendar.test.js weekdays.test.js 2>&1 | grep -E "^(✖|✔)|^ℹ (pass|fail)" | sort -u
done
