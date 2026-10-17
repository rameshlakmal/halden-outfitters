#!/usr/bin/env bash
# Posts the end of a log file as a GitHub Actions error annotation, so a failure can be read from the run
# summary without opening the raw logs. Usage: ci-annotate.sh <title> <log file>
title="$1"
log="$2"
[ -f "$log" ] || { echo "::error title=$title::($log was not written)"; exit 0; }
# Annotations are one line: escape %, CR and LF as the runner expects, and keep the last 60 lines.
body=$(tail -n 60 "$log" | sed -e 's/\x1b\[[0-9;]*m//g' | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk '{printf "%s%%0A", $0}')
echo "::error title=$title::$body"
