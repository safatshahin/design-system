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

import { startMCPServer } from '../src/mcp/index.ts';

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
  await startMCPServer(designSystemPath);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[MCP] Fatal error: ${message}`);
  process.exit(1);
});
