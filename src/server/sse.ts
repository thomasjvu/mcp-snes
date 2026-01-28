import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { SNESEmulator } from '../snes';
import { EmulatorService } from '../emulatorService';
import { createSNESServer } from './server';
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import { setupWebUI, setupRomSelectionUI } from '../ui';
import { log } from '../utils/logger';

export async function startSseServer(port?: number): Promise<void> {
  const ssePort = port || (process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3001);

  const emulator = new SNESEmulator();
  const emulatorService = new EmulatorService(emulator);
  const server = createSNESServer(emulatorService);

  const app = express();

  app.use(express.json());

  // Configure multer for ROM uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const romsDir = path.join(process.cwd(), 'roms');
      if (!fs.existsSync(romsDir)) {
        fs.mkdirSync(romsDir);
      }
      cb(null, romsDir);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    }
  });
  const upload = multer({ storage });

  // Store transports by session ID
  const transports: Record<string, SSEServerTransport> = {};

  // SSE endpoint for establishing the stream
  app.get('/mcp', async (req: Request, res: Response) => {
    log.info('Received GET request to /mcp (establishing SSE stream)');

    try {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;

      transport.onclose = () => {
        log.info(`SSE transport closed for session ${sessionId}`);
        delete transports[sessionId];
      };

      await server.connect(transport);
      log.info(`Established SSE stream with session ID: ${sessionId}`);
    } catch (error) {
      log.error('Error establishing SSE stream:', error);
      if (!res.headersSent) {
        res.status(500).send('Error establishing SSE stream');
      }
    }
  });

  // Messages endpoint for receiving client JSON-RPC requests
  app.post('/messages', async (req: Request, res: Response) => {
    log.info('Received POST request to /messages');

    const sessionId = req.query.sessionId as string | undefined;

    if (!sessionId) {
      log.error('No session ID provided in request URL');
      res.status(400).send('Missing sessionId parameter');
      return;
    }

    const transport = transports[sessionId];
    if (!transport) {
      log.error(`No active transport found for session ID: ${sessionId}`);
      res.status(404).send('Session not found');
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      log.error('Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).send('Error handling request');
      }
    }
  });

  // Set up ROM selection UI
  setupRomSelectionUI(app, emulatorService);

  // Handle ROM upload
  app.post('/upload', upload.single('rom'), (req, res) => {
    res.redirect('/');
  });

  // Handle ROM selection
  app.get('/snes', (req, res) => {
    const romPath = req.query.rom as string;

    if (!romPath || !fs.existsSync(romPath)) {
      res.redirect('/');
      return;
    }

    try {
      emulatorService.loadRom(romPath);
      res.redirect('/emulator');
    } catch (error) {
      log.error(`Error loading ROM: ${error}`, error);
      res.redirect('/');
    }
  });

  // Set up web UI
  setupWebUI(app, emulatorService);

  // Start the Express server
  const httpServer = http.createServer(app);
  httpServer.listen(ssePort, () => {
    log.info(`SNES MCP Server listening on http://localhost:${ssePort}`);
    log.info(`SNES Web UI available at http://localhost:${ssePort}/emulator`);
  });
}
