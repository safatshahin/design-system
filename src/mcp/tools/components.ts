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

const SEARCH_DEFAULT_LIMIT = 10;

export function createComponentTools(): Tool[] {
  return [
    {
      name: 'list_components',
      description:
        'List every component in the design system with its one-line ' +
        'purpose - the cheapest way to see what exists before ' +
        'searching or fetching details.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'search_components',
      description:
        'Search components by name, keyword, category, or related ' +
        'token. Results are ranked (name matches first). A query of ' +
        '"*" returns the complete catalogue - equivalent to ' +
        'list_components, which is the canonical way to enumerate ' +
        'everything.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search query such as a component name, token, or category.',
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
      name: 'get_component_api',
      description:
        "Get a component's purpose, props (name, type, required, doc), " +
        'related design tokens, and source file locations.',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Component name such as Button or Checkbox.',
          },
        },
        required: ['component_name'],
      },
    },
    {
      name: 'get_component_example',
      description:
        'Get the Storybook example code for a component (real story ' +
        'source, one entry per story).',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Component name such as Button or Checkbox.',
          },
          example_name: {
            type: 'string',
            description: 'Optional story name to fetch just that example.',
          },
        },
        required: ['component_name'],
      },
    },
    {
      name: 'check_component_accessibility',
      description:
        'Return source-derived accessibility notes for a component. ' +
        'These are heuristic signals from the source (ARIA/keyboard/' +
        'screen-reader mentions), not an automated audit.',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Component name such as Button or Checkbox.',
          },
        },
        required: ['component_name'],
      },
    },
    {
      name: 'find_components_using_token',
      description:
        'Find components whose source references a given design token.',
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
  ];
}

export async function handleComponentTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  indexer: DesignSystemIndexer,
): Promise<string> {
  switch (toolName) {
    case 'list_components':
      return JSON.stringify(handleListComponents(indexer), null, 2);
    case 'search_components':
      return JSON.stringify(
        handleSearchComponents(toolInput, indexer),
        null,
        2,
      );
    case 'get_component_api':
      return JSON.stringify(handleGetComponentApi(toolInput, indexer), null, 2);
    case 'get_component_example':
      return JSON.stringify(
        handleGetComponentExample(toolInput, indexer),
        null,
        2,
      );
    case 'check_component_accessibility':
      return JSON.stringify(
        handleCheckComponentAccessibility(toolInput, indexer),
        null,
        2,
      );
    case 'find_components_using_token':
      return JSON.stringify(
        handleFindComponentsUsingToken(toolInput, indexer),
        null,
        2,
      );
    default:
      return JSON.stringify({ error: `Unknown component tool: ${toolName}` });
  }
}

function dataState(indexer: DesignSystemIndexer) {
  const stats = indexer.getStats();
  return (
    `${stats.componentCount} components, ${stats.tokenCount} tokens ` +
    `(from ${stats.tokensLoadedFrom ?? 'NOWHERE - tokens missing'}), ` +
    `indexed ${stats.lastIndexed}`
  );
}

function handleListComponents(indexer: DesignSystemIndexer) {
  return {
    dataState: dataState(indexer),
    components: indexer.getAllComponents().map((component) => ({
      name: component.name,
      purpose: component.description,
      category: component.category,
    })),
  };
}

function handleSearchComponents(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const query = String(input.query ?? '').trim();
  if (!query) {
    return {
      error:
        'Query cannot be empty. Use "*" (or the ' +
        'list_components tool) to list every component.',
    };
  }
  // "*" = complete catalogue: agents probe for a list-all mode, and
  // returning nothing sent them on multi-query category sweeps that
  // could never be provably complete. The catalogue is small, so "*"
  // defaults to returning all of it.
  const results =
    query === '*'
      ? indexer.getAllComponents()
      : indexer.searchComponents(query);
  const limit = Math.max(
    1,
    Number(input.limit) ||
      (query === '*' ? results.length : SEARCH_DEFAULT_LIMIT),
  );
  return {
    query,
    count: results.length,
    dataState: dataState(indexer),
    results: results.slice(0, limit).map((component) => ({
      name: component.name,
      description: component.description,
      category: component.category,
      // The full token list per hit dominated the payload without
      // being asked for - get_component_api carries it instead.
      relatedTokenCount: component.relatedTokens?.length ?? 0,
    })),
  };
}

function handleGetComponentApi(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const componentName = String(input.component_name ?? '').trim();
  if (!componentName) {
    return { error: 'Component name is required.' };
  }

  const component = indexer.getComponent(componentName);
  if (!component) {
    return {
      error: `Component "${componentName}" not found.`,
      availableComponents: indexer.getAllComponents().map((item) => item.name),
    };
  }

  // Examples ship as titles here; get_component_example returns the code.
  return {
    ...component,
    examples: (component.examples ?? []).map((example) => example.title),
  };
}

function handleGetComponentExample(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const componentName = String(input.component_name ?? '').trim();
  if (!componentName) {
    return { error: 'Component name is required.' };
  }

  const component = indexer.getComponent(componentName);
  if (!component) {
    return {
      error: `Component "${componentName}" not found.`,
      availableComponents: indexer.getAllComponents().map((item) => item.name),
    };
  }

  const wanted = String(input.example_name ?? '')
    .trim()
    .toLowerCase();
  const examples = (component.examples ?? []).filter(
    (example) => !wanted || example.title.toLowerCase() === wanted,
  );
  if (wanted && examples.length === 0) {
    return {
      error:
        `Example "${input.example_name}" not found for ` + `${component.name}.`,
      availableExamples: (component.examples ?? []).map(
        (example) => example.title,
      ),
    };
  }

  return {
    component: component.name,
    exampleCount: examples.length,
    examples,
    storyPath: component.storyPath,
  };
}

function handleCheckComponentAccessibility(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const componentName = String(input.component_name ?? '').trim();
  if (!componentName) {
    return { error: 'Component name is required.' };
  }

  const component = indexer.getComponent(componentName);
  if (!component) {
    return {
      error: `Component "${componentName}" not found.`,
      availableComponents: indexer.getAllComponents().map((item) => item.name),
    };
  }

  return {
    component: component.name,
    accessibilityNotes: component.accessibility ?? [],
    disclaimer:
      'Heuristic source signals only - not an automated accessibility ' +
      'audit. Verify with a real audit before relying on this.',
    guidance: [
      'Validate semantic HTML for the rendered output.',
      'Confirm focus management for interactive variants.',
      'Test with keyboard-only navigation and a screen reader.',
    ],
  };
}

function handleFindComponentsUsingToken(
  input: Record<string, unknown>,
  indexer: DesignSystemIndexer,
) {
  const tokenName = String(input.token_name ?? '').trim();
  if (!tokenName) {
    return { error: 'Token name is required.' };
  }

  const components = indexer.findComponentsUsingToken(tokenName);
  return {
    token: tokenName,
    count: components.length,
    components: components.map((component) => component.name),
  };
}
