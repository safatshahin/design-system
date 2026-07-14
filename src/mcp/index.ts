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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { DesignSystemIndexer } from './indexer.js';
import {
  createComponentTools,
  handleComponentTool,
} from './tools/components.js';
import {
  createGuidelineTools,
  handleGuidelineTool,
} from './tools/guidelines.js';
import { createTokenTools, handleTokenTool } from './tools/tokens.js';

export class DesignSystemMCPServer {
  private readonly server: Server;
  private readonly indexer: DesignSystemIndexer;
  private allTools: Tool[] = [];

  constructor(designSystemPath: string) {
    this.server = new Server(
      { name: 'moodle-design-system-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    this.indexer = new DesignSystemIndexer(designSystemPath);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.allTools,
    }));

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request): Promise<CallToolResult> => {
        const toolName = request.params.name;
        const toolInput = (request.params.arguments ?? {}) as Record<
          string,
          unknown
        >;

        try {
          if (COMPONENT_TOOL_NAMES.has(toolName)) {
            return this.createTextResult(
              await handleComponentTool(toolName, toolInput, this.indexer),
            );
          }

          if (GUIDELINE_TOOL_NAMES.has(toolName)) {
            return this.createTextResult(
              await handleGuidelineTool(toolName, toolInput, this.indexer),
            );
          }

          if (TOKEN_TOOL_NAMES.has(toolName)) {
            return this.createTextResult(
              await handleTokenTool(toolName, toolInput, this.indexer),
            );
          }

          return this.createErrorResult(`Unknown tool: ${toolName}`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          return this.createErrorResult(message);
        }
      },
    );
  }

  private createTextResult(text: string): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  }

  private createErrorResult(message: string): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }

  async initialize(): Promise<void> {
    await this.indexer.index();
    this.allTools = [
      ...createComponentTools(),
      ...createTokenTools(this.indexer.getTokenCategories()),
      ...createGuidelineTools(this.indexer.getStats().guidelineSources),
    ];
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

export async function startMCPServer(designSystemPath: string): Promise<void> {
  const server = new DesignSystemMCPServer(designSystemPath);
  await server.initialize();
  await server.run();
}

// Sets, not object literals: `in` on an object matched prototype keys
// ("constructor", "toString") and routed them into the handlers.
const COMPONENT_TOOL_NAMES = new Set([
  'list_components',
  'search_components',
  'get_component_api',
  'get_component_example',
  'check_component_accessibility',
  'find_components_using_token',
]);

const GUIDELINE_TOOL_NAMES = new Set(['search_guidelines', 'get_guideline']);

const TOKEN_TOOL_NAMES = new Set([
  'search_tokens',
  'get_token_value',
  'get_tokens_by_category',
  'validate_token_usage',
  'list_token_categories',
]);
