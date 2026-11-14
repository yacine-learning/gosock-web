#!/usr/bin/env bash
# Builds everything the browser needs to compile and link Go programs:
#   toolchain/compile.wasm.gz, toolchain/link.wasm.gz  the Go compiler and linker, as WebAssembly
#   toolchain/gofmt.wasm.gz                            go/format, for the editor's Format command
#   toolchain/std.pack.gz                              the standard library packages, compiled for js/wasm
#                                                      with the files in gosrc/ replacing Go's own
#   js/wasm_exec.js                                    Go's JavaScript support file
# Needs the Go version below installed. Run from the repo root: bash tools/build-toolchain.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
GOVER=${GOVER:-go1.24.7}
if [ -d "/usr/local/$GOVER" ]; then export PATH="/usr/local/$GOVER/bin:$PATH"; fi
[ "$(go env GOVERSION)" = "$GOVER" ] || { echo "need $GOVER, found $(go env GOVERSION)"; exit 1; }
GOROOT=$(go env GOROOT)
# packages a program may import (their dependencies are added automatically)
PKGS="bufio bytes context encoding/binary encoding/hex errors flag fmt hash/crc32 crypto/sha256 io io/fs log math math/rand net os path/filepath runtime slices sort strconv strings sync sync/atomic syscall time unicode/utf8 unsafe"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
OUT=$ROOT/toolchain; mkdir -p "$OUT"

echo "== compiler and linker"
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$TMP/compile.wasm" cmd/compile
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$TMP/link.wasm" cmd/link
gzip -9 -n -c "$TMP/compile.wasm" > "$OUT/compile.wasm.gz"
gzip -9 -n -c "$TMP/link.wasm" > "$OUT/link.wasm.gz"
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$TMP/gofmt.wasm" tools/gofmt/main.go
gzip -9 -n -c "$TMP/gofmt.wasm" > "$OUT/gofmt.wasm.gz"

echo "== standard library with gosrc/ overlay"
python3 - "$ROOT" "$GOROOT" "$TMP" <<'PY'
import json, os, sys
root, goroot, tmp = sys.argv[1:]
rep = {}
for d, _, fs in os.walk(os.path.join(root, 'gosrc')):
    for f in fs:
        src = os.path.join(d, f)
        rel = os.path.relpath(src, os.path.join(root, 'gosrc'))
        rep[os.path.join(goroot, 'src', rel)] = src
# syscall_js.go: drop the Sendfile stub (gosrc/syscall/net_js.go has the real one)
p = os.path.join(goroot, 'src/syscall/syscall_js.go')
s = open(p).read()
stub = 'func Sendfile(outfd int, infd int, offset *int64, count int) (written int, err error) {\n\treturn 0, ENOSYS\n}\n'
assert stub in s, 'Sendfile stub not found in syscall_js.go'
open(os.path.join(tmp, 'syscall_js.go'), 'w').write(s.replace(stub, ''))
rep[p] = os.path.join(tmp, 'syscall_js.go')
# tables_js.go: error texts start with a lower-case letter, as Go prints them on Linux
import re
p = os.path.join(goroot, 'src/syscall/tables_js.go')
s = open(p).read()
s2, n = re.subn(r'(?m)^(\t(?:E[A-Z0-9]+):\s+")([A-Z])(?=[a-z ])', lambda m: m.group(1) + m.group(2).lower(), s)
assert n > 50, 'errorstr table not found in tables_js.go'
open(os.path.join(tmp, 'tables_js.go'), 'w').write(s2)
rep[p] = os.path.join(tmp, 'tables_js.go')
json.dump({'Replace': rep}, open(os.path.join(tmp, 'overlay.json'), 'w'))
PY
export GOOS=js GOARCH=wasm GOCACHE="$TMP/cache" GOFLAGS=-trimpath
go list -overlay "$TMP/overlay.json" -export -deps -f '{{if .Export}}{{.ImportPath}} {{.Export}}{{end}}' $PKGS > "$TMP/list"
python3 - "$TMP" "$OUT" <<'PY'
import gzip, json, struct, sys
tmp, out = sys.argv[1:]
index, blob = {}, bytearray()
for line in open(tmp + '/list'):
    name, path = line.split()
    data = open(path, 'rb').read()
    index[name] = [len(blob), len(data)]
    blob += data
head = json.dumps(index).encode()
with gzip.GzipFile(out + '/std.pack.gz', 'wb', 9, mtime=0) as f:
    f.write(struct.pack('<I', len(head)) + head + blob)
print(len(index), 'packages,', len(blob) // 1024, 'KiB')
PY
cp "$GOROOT/lib/wasm/wasm_exec.js" "$ROOT/js/wasm_exec.js"
echo "$(go env GOVERSION)-$(cat "$OUT"/*.gz | sha256sum | cut -c1-12)" > "$OUT/VERSION"
ls -la "$OUT"
