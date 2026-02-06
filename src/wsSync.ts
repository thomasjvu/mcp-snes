import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { log } from './utils/logger';
import type { EmulatorService } from './emulatorService';
import { SNESButton } from './types';

const VALID_BUTTONS = new Set(Object.values(SNESButton));

export class WsSync {
  private wss: WebSocketServer;
  private emulatorService?: EmulatorService;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      log.info('WebSocket client connected');
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleClientMessage(msg, ws);
        } catch (e) {
          log.warn('Invalid WebSocket message from client');
        }
      });
    });
    log.info('WebSocket sync server attached at /ws');
  }

  setEmulatorService(emulatorService: EmulatorService): void {
    this.emulatorService = emulatorService;
  }

  private handleClientMessage(msg: any, sender: WebSocket): void {
    if (msg.type === 'button_press' && VALID_BUTTONS.has(msg.button)) {
      const button = msg.button as SNESButton;
      const durationFrames = typeof msg.durationFrames === 'number' && msg.durationFrames > 0
        ? msg.durationFrames : 25;

      // Replay on server-side emulator
      if (this.emulatorService?.isRomLoaded()) {
        try {
          this.emulatorService.pressButtonLocal(button, durationFrames);
        } catch (e) {
          log.warn('Failed to replay browser button press on server', String(e));
        }
      }

      // Broadcast to all OTHER browser clients (not back to sender)
      const outMsg = JSON.stringify({ type: 'button_press', button, durationFrames, source: 'browser' });
      for (const client of this.wss.clients) {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
          client.send(outMsg);
        }
      }
    }
  }

  broadcastButtonPress(button: string, durationFrames: number): void {
    const msg = JSON.stringify({ type: 'button_press', button, durationFrames, source: 'mcp' });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  broadcastWaitFrames(durationFrames: number): void {
    const msg = JSON.stringify({ type: 'wait_frames', durationFrames });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  broadcastAdvanceFrame(): void {
    const msg = JSON.stringify({ type: 'advance_frame' });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  broadcastRomLoaded(initialFrames: number = 0): void {
    const msg = JSON.stringify({ type: 'rom_loaded', initialFrames });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }
}
