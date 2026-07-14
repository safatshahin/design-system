// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { DesignSystemIndexer } from '../indexer.js';
import type { TokenMetadata } from '../types.js';

const SEARCH_DEFAULT_LIMIT = 25;
const CATEGORY_DEFAULT_LIMIT = 50;

export function createTokenTools(categories: string[]): Tool[] {
  // Advertise ONLY what is actually loaded. The old fallback enum
  // (colors/spacing/... invented at boot when zero tokens loaded) sent
  // agents chasing categories that could never match.
  const noTokens = categories.length === 0;
  const categoryProperty = noTokens
    ? {
        type: 'string',
        description:
          'NO TOKENS ARE LOADED in this build - run `npm run ' +
          'build-tokens` in the design-system checkout and restart ' +
          'the server.',
      }
    : {
        type: 'string',
        enum: categories,
        description: 'Optional token category filter.',
      };

  return [
    {
      name: 'search_tokens',
      description:
        'Search design tokens by name, value, or category. Ranked, ' +
        'name matches first. A query of "*" matches every token ' +
        '(combine with category to enumerate one category).' +
        (noTokens ? ' WARNING: no tokens are loaded in this build.' : ''),
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search query such as spacing, primary, or --mds-spacing-xs.',
          },
          category: categoryProperty,
          limit: {
            type: 'number',
            description: `Max results (default ${SEARCH_DEFAULT_LIMIT}).`,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_token_value',
      description: 'Get the value and metadata for a design token.',
      inputSchema: {
        type: 'object',
        properties: {
          token_name: {
            type: 'string',
            description: 'Token name like mds-spacing-xs or --mds-spacing-xs.',
          },
        },
        required: ['token_name'],
      },
    },
    {
      name: 'get_tokens_by_category',
      description:
        'List tokens within a category ' +
        (noTokens
          ? '(WARNING: no tokens are loaded in this build).'
          : `(available: ${categories.join(', ')}).`),
      inputSchema: {
        type: 'object',
        properties: {
          category: categoryProperty,
          limit: {
            type: 'number',
            description:
              `Max results (default ${CATEGORY_DEFAULT_LIMIT}); the ` +
              'response reports the total.',
          },
        },
        required: ['category'],
      },
    },
    {
      name: 'validate_token_usage',
      description: 'Return source-agnostic guidance for using a token safely.',
      inputSchema: {
        type: 'object',
        properties: {
          token_name: {
            type: 'string',
            description: 'Token name like mds-spacing-xs or --mds-spacing-xs.',
          },
        },
        required: ['token_name'],
      },
    },
    {
      name: 'list_token_categories',
      description:
        'List the token categories available in the current build output.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

export async function handleTokenTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  indexer: DesignSystemIndexer,
): Promise<string> {
  // Every token tool degrades identically when the build has no
  // tokens: an actionable error instead of an empty "not found".
  if (
    indexer.getStats().tokenCount === 0 &&
    toolName !== 'list_token_categories'
  ) {
    return JSON.stringify(
      {
        error:
          'No design tokens are loaded: neither dist/tokens/css nor ' +
          'tokens/css exists in this checkout. Run `npm run ' +
          'build-tokens` and restart the MCP server.',
      },
      null,
      2,
    );
  }

  switch (toolName) {
    case 'search_tokens':
      return JSON.stringify(handleSearchTokens(toolInput, indexer), null, 2);
    case 'get_token_value':
      return JSON.stringify(handleGetTokenValue(toolInput, indexer), null, 2);
    case 'get_tokens_by_category':
      return JSON.stringify(
        handleGetTokensByCategory(toolInput, indexer),
        null,
        2,
      );
    case 'validate_token_usage':
      return JSON.stringify(
        handleValidateTokenUsage(toolInput, indexer),
        null,
        2,
      );
    case 'list_token_categories':
      return JSON.stringify(handleListTokenCategories(indexer), null, 2);
    default:
      return JSON.stringify({ error: `Unknown token tool: ${toolName}` });
  }
}

/** Compact row - cssVariable is always `--<name>`, so it is stated
 *  once per response instead of repeated per token. */
function tokenRow(token: TokenMetadata) {
  return {
    name: token.name,
    value: token.value,
    category: token.category,
  };
}

function handleSearchTokens(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const query = String(input.query ?? '').trim();
  const category = input.category ? String(input.category) : undefined;
  const limit = Math.max(1, Number(input.limit) || SEARCH_DEFAULT_LIMIT);

  if (!query) {
    return {
      error:
        'Query cannot be empty. Use "*" to match every ' +
        'token, or list_token_categories for an overview.',
    };
  }

  // "*" matches everything: every token name carries the mds- prefix,
  // so searching for it is a complete, category-filterable match.
  const results = indexer.searchTokens(query === '*' ? 'mds' : query, category);
  return {
    query,
    category: category ?? 'all',
    count: results.length,
    cssVariableFormat: '--<name>',
    results: results.slice(0, limit).map(tokenRow),
    ...(results.length > limit
      ? {
          note:
            `showing ${limit} of ${results.length} - raise limit or ` +
            'narrow the query',
        }
      : {}),
    ...(results.length === 0
      ? {
          suggestions: indexer.suggestTokens(query),
          categories: indexer.getTokenCategories(),
        }
      : {}),
  };
}

function handleGetTokenValue(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const tokenName = String(input.token_name ?? '').trim();
  if (!tokenName) {
    return { error: 'Token name is required.' };
  }

  const token = indexer.getToken(tokenName);
  if (!token) {
    return {
      error: `Token "${tokenName}" not found.`,
      suggestions: indexer.suggestTokens(tokenName),
      categories: indexer.getTokenCategories(),
    };
  }

  return token;
}

function handleGetTokensByCategory(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const category = String(input.category ?? '').trim();
  const limit = Math.max(1, Number(input.limit) || CATEGORY_DEFAULT_LIMIT);
  if (!category) {
    return { error: 'Category is required.' };
  }

  const tokens = indexer.getTokensByCategory(category);
  if (tokens.length === 0) {
    return {
      category,
      count: 0,
      results: [],
      categories: indexer.getTokenCategories(),
    };
  }
  return {
    category,
    count: tokens.length,
    cssVariableFormat: '--<name>',
    results: tokens.slice(0, limit).map(tokenRow),
    ...(tokens.length > limit
      ? {
          note:
            `showing ${limit} of ${tokens.length} - raise limit or use ` +
            'search_tokens to narrow',
        }
      : {}),
  };
}

function handleValidateTokenUsage(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const tokenName = String(input.token_name ?? '').trim();
  if (!tokenName) {
    return { error: 'Token name is required.' };
  }

  const token = indexer.getToken(tokenName);
  if (!token) {
    return {
      error: `Token "${tokenName}" not found.`,
      suggestions: indexer.suggestTokens(tokenName),
    };
  }

  return {
    token: token.name,
    category: token.category,
    value: token.value,
    cssVariable: token.cssVariable,
    bestPractices: getTokenBestPractices(token),
    examples: getTokenUsageExamples(token),
  };
}

function handleListTokenCategories(indexer: DesignSystemIndexer) {
  const stats = indexer.getStats();
  return {
    tokenCount: stats.tokenCount,
    themes: stats.themes,
    tokensLoadedFrom: stats.tokensLoadedFrom,
    categories: indexer.getTokenCategories().map((category) => ({
      name: category,
      count: indexer.getTokensByCategory(category).length,
    })),
    ...(stats.tokenCount === 0
      ? {
          error:
            'No tokens loaded - run `npm run build-tokens` and ' +
            'restart the MCP server.',
        }
      : {}),
  };
}

function getTokenBestPractices(token: TokenMetadata): string[] {
  const common = [
    'Use the CSS variable form instead of hardcoding the raw value.',
  ];

  switch (token.category) {
    case 'colors':
      return [
        ...common,
        'Check color contrast against the target background before shipping.',
      ];
    case 'spacing':
      return [
        ...common,
        'Prefer margin, padding, and gap over ad hoc pixel values.',
      ];
    case 'typography':
      return [
        ...common,
        'Apply typography tokens consistently across the same semantic text role.',
      ];
    default:
      return common;
  }
}

function getTokenUsageExamples(token: TokenMetadata): Record<string, string> {
  return {
    css: `var(${token.cssVariable})`,
    declaration: inferCssDeclaration(token),
  };
}

function inferCssDeclaration(token: TokenMetadata): string {
  switch (token.category) {
    case 'colors':
      return `color: var(${token.cssVariable});`;
    case 'spacing':
      return `gap: var(${token.cssVariable});`;
    case 'typography':
      return `font-size: var(${token.cssVariable});`;
    case 'shadows':
      return `box-shadow: var(${token.cssVariable});`;
    case 'borders':
      return `border-color: var(${token.cssVariable});`;
    default:
      return `var(${token.cssVariable})`;
  }
}
