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

const SEARCH_DEFAULT_LIMIT = 8;
const SNIPPET_LENGTH = 200;
const SECTION_MAX_CHARS = 6000;

export function createGuidelineTools(sources: string[]): Tool[] {
  const noGuidelines = sources.length === 0;
  return [
    {
      name: 'search_guidelines',
      description:
        "Search the design team's written guidance (usage decisions, " +
        'foundations, accessibility rationale, contribution rules) - ' +
        'use this for WHY/WHEN design questions; the component and ' +
        'token tools answer WHAT exists. Returns ranked sections with ' +
        'ids for get_guideline.' +
        (noGuidelines
          ? ' WARNING: no guideline documents were found in this checkout.'
          : ` Sources: ${sources.join(', ')}.`),
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search terms, e.g. "button placement", "form validation".',
          },
          source: noGuidelines
            ? { type: 'string', description: 'No guideline sources loaded.' }
            : {
                type: 'string',
                enum: sources,
                description: 'Optional: limit to one guideline document.',
              },
          limit: {
            type: 'number',
            description: `Max results (default ${SEARCH_DEFAULT_LIMIT}).`,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_guideline',
      description:
        'Fetch one guideline section by the id a search_guidelines ' +
        'result returned.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Section id from search_guidelines, e.g. ' +
              '"design-system:button-anatomy".',
          },
        },
        required: ['id'],
      },
    },
  ];
}

export async function handleGuidelineTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  indexer: DesignSystemIndexer,
): Promise<string> {
  if (indexer.getStats().guidelineCount === 0) {
    return JSON.stringify(
      {
        error:
          'No guideline documents are loaded - the checkout has no ' +
          '.github/instructions/*.instructions.md files. Pull the ' +
          'repository (or run `npm run build-docs` to regenerate the ' +
          'ZeroHeight export) and restart the MCP server.',
      },
      null,
      2,
    );
  }

  switch (toolName) {
    case 'search_guidelines':
      return JSON.stringify(
        handleSearchGuidelines(toolInput, indexer),
        null,
        2,
      );
    case 'get_guideline':
      return JSON.stringify(handleGetGuideline(toolInput, indexer), null, 2);
    default:
      return JSON.stringify({ error: `Unknown guideline tool: ${toolName}` });
  }
}

function handleSearchGuidelines(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const query = String(input.query ?? '').trim();
  const source = input.source ? String(input.source) : undefined;
  const limit = Math.max(1, Number(input.limit) || SEARCH_DEFAULT_LIMIT);
  if (!query) {
    return { error: 'Query cannot be empty.' };
  }

  const results = indexer.searchGuidelines(query, source);
  return {
    query,
    source: source ?? 'all',
    count: results.length,
    results: results.slice(0, limit).map((section) => ({
      id: section.id,
      title: section.title,
      source: section.source,
      snippet: makeSnippet(section.text, query),
    })),
    ...(results.length > limit
      ? {
          note:
            `showing ${limit} of ${results.length} - raise limit or ` +
            'narrow the query',
        }
      : {}),
    ...(results.length === 0
      ? { suggestions: indexer.suggestGuidelines(query) }
      : {}),
  };
}

function handleGetGuideline(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const id = String(input.id ?? '').trim();
  if (!id) {
    return { error: 'Section id is required (from search_guidelines).' };
  }

  const section = indexer.getGuideline(id);
  if (!section) {
    return {
      error: `Guideline section "${id}" not found.`,
      suggestions: indexer.suggestGuidelines(id),
    };
  }

  const truncated = section.text.length > SECTION_MAX_CHARS;
  return {
    id: section.id,
    title: section.title,
    source: section.source,
    text: truncated
      ? `${section.text.slice(0, SECTION_MAX_CHARS)}\n[... truncated]`
      : section.text,
    ...(truncated
      ? {
          note: `section is ${section.text.length} chars; truncated to ${SECTION_MAX_CHARS}`,
        }
      : {}),
  };
}

function makeSnippet(text: string, query: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  const lower = plain.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let hit = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at !== -1 && (hit === -1 || at < hit)) {
      hit = at;
    }
  }
  const start = Math.max(0, (hit === -1 ? 0 : hit) - 40);
  const snippet = plain.slice(start, start + SNIPPET_LENGTH).trim();
  return (
    (start > 0 ? '...' : '') +
    snippet +
    (start + SNIPPET_LENGTH < plain.length ? '...' : '')
  );
}
