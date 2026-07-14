#!/usr/bin/env node
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

import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface TestCase {
  name: string;
  args: Record<string, unknown>;
}

function parseArgs(): string {
  const args = process.argv.slice(2);
  let designSystemPath = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === '--path' || arg === '-p') && args[index + 1]) {
      designSystemPath = args[index + 1];
      index += 1;
    }
  }

  return path.resolve(designSystemPath);
}

async function main(): Promise<void> {
  const designSystemPath = parseArgs();

  const transport = new StdioClientTransport({
    command: 'npm',
    args: ['run', 'mcp:serve', '--', '--path', designSystemPath],
    cwd: designSystemPath,
    stderr: 'inherit',
  });

  const client = new Client({
    name: 'moodle-design-system-mcp-smoke-test',
    version: '1.0.0',
  });

  await client.connect(transport);

  try {
    console.log(`Connected to MCP server for ${designSystemPath}`);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
    console.log(`Tools (${toolNames.length}): ${toolNames.join(', ')}`);

    const testCases: TestCase[] = [
      { name: 'search_components', args: { query: 'button' } },
      { name: 'get_component_api', args: { component_name: 'Button' } },
      { name: 'search_tokens', args: { query: 'spacing' } },
      { name: 'list_token_categories', args: {} },
      { name: 'search_guidelines', args: { query: 'button', limit: 2 } },
    ];

    for (const testCase of testCases) {
      console.log(`\n== ${testCase.name} ==`);
      const result = await client.callTool({
        name: testCase.name,
        arguments: testCase.args,
      });

      for (const block of result.content) {
        if (block.type === 'text') {
          console.log(block.text);
        }
      }

      if (result.isError) {
        throw new Error(`Tool ${testCase.name} returned an error result.`);
      }
    }

    console.log('\nSmoke test passed.');
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
