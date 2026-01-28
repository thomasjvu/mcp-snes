import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SNESEmulator } from '../snes';
import { EmulatorService } from '../emulatorService';
import { createSNESServer } from './server';
import * as path from 'path';
import * as fs from 'fs';
import open from 'open';
import express, { Request, Response } from 'express';
import http from 'http';
import multer from 'multer';
import { setupWebUI, setupRomSelectionUI } from '../ui';
import { log } from '../utils/logger';

export async function startStdioServer(): Promise<void> {
  const emulator = new SNESEmulator();
  const emulatorService = new EmulatorService(emulator);
  const server = createSNESServer(emulatorService);

  // Optionally auto-load ROM from environment variable
  const romPath = process.env.ROM_PATH;
  if (romPath) {
    if (!fs.existsSync(romPath)) {
      log.error(`ROM file not found: ${romPath}`);
      process.exit(1);
    }
    try {
      emulatorService.loadRom(romPath);
      log.info(`ROM loaded: ${path.basename(romPath)}`);
    } catch (error) {
      log.error(`Error loading ROM: ${error}`);
      process.exit(1);
    }
  } else {
    log.info('No ROM_PATH set, starting without ROM loaded');
  }

  // Create Express app for web UI
  const app = express();
  const port = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3001;

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

  // Set up web UI routes
  setupWebUI(app, emulatorService);
  setupRomSelectionUI(app, emulatorService);

  // Handle ROM upload
  app.post('/upload', upload.single('rom'), (req: Request, res: Response) => {
    res.redirect('/');
  });

  // Handle ROM selection from UI
  app.get('/snes', (req: Request, res: Response) => {
    const relativeRomPath = req.query.rom as string;

    if (!relativeRomPath) {
      log.error('[stdio /snes] No ROM path provided in query.');
      res.redirect('/');
      return;
    }

    const absoluteRomPath = path.resolve(process.cwd(), relativeRomPath);
    log.info(`[stdio /snes] Resolved path: ${absoluteRomPath}`);

    if (!fs.existsSync(absoluteRomPath)) {
      log.error(`[stdio /snes] ROM file not found: ${absoluteRomPath}`);
      res.status(404).send(`ROM not found: ${relativeRomPath}`);
      return;
    }

    try {
      emulatorService.loadRom(absoluteRomPath);
      log.info(`[stdio /snes] ROM loaded: ${absoluteRomPath}`);
      res.redirect('/emulator');
    } catch (error) {
      log.error(`[stdio /snes] Error loading ROM:`, error);
      res.status(500).send('Error loading ROM');
    }
  });

  // Start the Express server
  const httpServer = http.createServer(app);
  httpServer.listen(port, () => {
    log.info(`SNES Emulator available at http://localhost:${port}/emulator`);
    log.info(`ROM Selection available at http://localhost:${port}/`);
    open(`http://localhost:${port}/${emulatorService.isRomLoaded() ? 'emulator' : ''}`);
  });

  // Create the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('MCP server running on stdio');
}
