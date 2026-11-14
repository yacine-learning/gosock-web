#!/usr/bin/env bash
# Rebuilds js/vendor/codemirror.js (CodeMirror 6, MIT licence: js/vendor/CODEMIRROR-LICENSE) from
# tools/vendor/codemirror-entry.js. Needs node and network access to the npm registry.
# Run from the repo root: bash tools/vendor/build-codemirror.sh
set -euo pipefail
ROOT=$PWD; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cp tools/vendor/codemirror-entry.js "$TMP/entry.js"; cd "$TMP"
npm init -y >/dev/null
npm i --silent esbuild@0.28 @codemirror/view@6 @codemirror/state@6 @codemirror/commands@6 @codemirror/lang-go@6 @codemirror/language@6 @codemirror/autocomplete@6 @codemirror/search@6 @codemirror/lint@6 @lezer/highlight@1
./node_modules/.bin/esbuild entry.js --bundle --format=esm --minify --outfile="$ROOT/js/vendor/codemirror.js"
