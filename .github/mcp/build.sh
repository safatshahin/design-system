#!/usr/bin/env bash
# Builds the MCP release artifact from an UPSTREAM checkout plus this
# branch's MCP files, without merging the two in git.
#
#   .github/mcp/build.sh <upstream-checkout> <output-dir>
#
# Why not build this branch directly: it is upstream plus one commit, and
# keeping that commit rebased every night failed in two ways - text
# conflicts in package.json / package-lock.json whenever upstream bumped
# a dependency (which happens almost daily here), and GitHub refusing bot
# pushes of upstream commits that touch workflow files. Laying the MCP
# files over a fresh upstream checkout and adding the one dependency by
# command has neither problem: nothing is merged and nothing is pushed.
#
# The same script runs locally (needs Node 22+ and npm).
set -euo pipefail

OVERLAY="$(cd "$(dirname "$0")/../.." && pwd)"
UPSTREAM="$(cd "$1" && pwd)"
mkdir -p "$2"
OUT="$(cd "$2" && pwd)"

# The MCP server needs a newer SDK than upstream's package.json allows.
# Pinned EXACTLY: it arrives without a lockfile entry, and a floating
# range means every nightly build could bundle a different, untested
# SDK. Raising it is a deliberate edit followed by a local run of this
# script (the smoke test below is the check).
MCP_SDK='@modelcontextprotocol/sdk@1.29.0'

# 1. The MCP files: additions only, nothing upstream owns is replaced.
mkdir -p "$UPSTREAM/src" "$UPSTREAM/scripts"
rm -rf "$UPSTREAM/src/mcp"
cp -R "$OVERLAY/src/mcp" "$UPSTREAM/src/mcp"
cp "$OVERLAY/scripts/mcp-server.ts" "$UPSTREAM/scripts/mcp-server.ts"

cd "$UPSTREAM"

# 2. Dependencies: upstream's lockfile as is, then the SDK by command
#    (--no-save: the manifest and lockfile are never edited).
npm ci
npm install --no-save "$MCP_SDK"

# 3. The data the MCP indexes.
npm run build-tokens
npm run build-component-index

# 4. Bundle the server: esbuild compiles the TypeScript entry and
#    inlines the SDK, so consumers need no node_modules.
PKG="$OUT/design-system-mcp"
rm -rf "$PKG"
npx --yes esbuild@0.24.2 scripts/mcp-server.ts \
    --bundle --platform=node --format=esm --target=node18 \
    --outfile="$PKG/mcp-server.mjs"

# 5. Assemble. The indexer reads, relative to --path: components/*/*.tsx
#    and *.css (props, examples, token usage), dist/component-index.json,
#    tokens/css/*.css and .github/instructions/*.instructions.md.
mkdir -p "$PKG/dist" "$PKG/tokens" "$PKG/.github"
cp dist/component-index.json "$PKG/dist/"
cp -R tokens/css "$PKG/tokens/css"
cp -R .github/instructions "$PKG/.github/instructions"
rsync -a --exclude '*.test.tsx' --exclude '*.stories.tsx.snap' components/ "$PKG/components/"

# 6. Smoke test: the bundled server must start and load tokens. The tool
#    result is JSON embedded in a JSON string, so its quotes arrive
#    backslash-escaped.
SMOKE="$OUT/smoke.out"
printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"build","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_token_categories","arguments":{}}}' \
    | node "$PKG/mcp-server.mjs" --path "$PKG" > "$SMOKE"
if ! grep -Eq 'tokenCount\\?": ?[1-9]' "$SMOKE"; then
    echo "bundled server loaded no tokens" >&2
    tail -c 400 "$SMOKE" >&2
    exit 1
fi
rm -f "$SMOKE"

cd "$OUT"
tar -czf design-system-mcp.tar.gz design-system-mcp
rm -rf design-system-mcp
if command -v sha256sum >/dev/null; then SUM="sha256sum"; else SUM="shasum -a 256"; fi
$SUM design-system-mcp.tar.gz > SHA256SUMS
ls -la
