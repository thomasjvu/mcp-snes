import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EmulatorService } from '../emulatorService';
import { registerSNESTools } from '../tools';

export function createSNESServer(emulatorService: EmulatorService): McpServer {
  const server = new McpServer(
    {
      name: 'mcp-snes',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerSNESTools(server, emulatorService);

  return server;
}
