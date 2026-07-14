# Moodle Design System MCP

This directory contains a local MCP server for the Moodle design-system repo.
It exposes component and token lookup tools over stdio so an MCP client can ask
questions about this repository's components, stories, CSS, and built token
artifacts.

## Current Behavior

The fixed implementation now:

- uses the SDK's ESM-safe subpath imports such as
  `@modelcontextprotocol/sdk/types.js`
- runs via `tsx`, matching the rest of this repo's script tooling
- loads tokens from `dist/tokens/css/*.css`
- loads components from `dist/component-index.json` when available
- falls back to scanning `components/*` directly when the component index has
  not been built yet

## Tools

Component tools:

- `search_components`
- `get_component_api`
- `get_component_example`
- `check_component_accessibility`
- `find_components_using_token`

Token tools:

- `search_tokens`
- `get_token_value`
- `get_tokens_by_category`
- `validate_token_usage`
- `list_token_categories`

## Running It

From the repo root:

```bash
npm run build-component-index
npm run mcp:serve
```

The component-index build is recommended, but not required. If it is missing,
the MCP server falls back to scanning the source tree.

You can also point the server at another checkout:

```bash
npm run mcp:serve -- --path /path/to/design-system
```

## Quick Test

Run the local smoke test:

```bash
npm run mcp:test
```

Or against another checkout:

```bash
npm run mcp:test -- --path /path/to/design-system
```

It will:

- start the stdio MCP server
- list the registered tools
- call representative component and token tools
- print the returned JSON

## Notes

- `npm run mcp:serve` now uses `tsx scripts/mcp-server.ts`.
- If you only want fresher token data, run `npm run build-tokens`.
- If you want the cleanest component metadata, run `npm run build-component-index`.
