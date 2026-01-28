import { startStdioServer } from './server/stdio';
import { startSseServer } from './server/sse';
import dotenv from 'dotenv';
import { log } from './utils/logger';

dotenv.config();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isStdio = args.includes('--stdio');
  const isSse = args.includes('--sse');

  const ssePort = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3001;

  if (isSse) {
    log.info(`Starting SNES MCP server in SSE mode on port ${ssePort}`);
    await startSseServer(ssePort);
  } else if (isStdio) {
    log.info('Starting SNES MCP server in stdio mode');
    await startStdioServer();
  } else {
    // Default to stdio mode
    log.info('No mode specified, defaulting to stdio mode');
    await startStdioServer();
  }
}

main().catch(error => {
  log.error(`Error: ${error}`);
  process.exit(1);
});
