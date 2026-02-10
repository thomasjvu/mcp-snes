import {
  CallToolResult,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SNESButton } from './types';
import { EmulatorService } from './emulatorService';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './utils/logger';

export function registerSNESTools(server: McpServer, emulatorService: EmulatorService): void {
  // Register button press tools
  Object.values(SNESButton).forEach(button => {
    server.tool(
      `press_${button.toLowerCase()}`,
      `Press the ${button} button on the SNES controller`,
      {
        duration_frames: z.number().int().positive().optional().default(25).describe('Number of frames to hold the button'),
        include_screenshot: z.boolean().optional().default(true).describe('Whether to include a screenshot in the response (default true). Set to false to save context window space when you don\'t need to see the screen.')
      },
      async ({ duration_frames, include_screenshot }): Promise<CallToolResult> => {
        // Use async button press to prevent server blocking
        await emulatorService.pressButtonAsync(button, duration_frames);
        if (include_screenshot) {
          const screen = emulatorService.advanceFrameAndGetScreen();
          return { content: [screen] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ button, frames: duration_frames }) }] };
      }
    );
  });

  // Register wait_frames tool
  server.tool(
    'wait_frames',
    'Wait for a specified number of frames',
    {
      duration_frames: z.number().int().positive().describe('Number of frames to wait').default(100),
      include_screenshot: z.boolean().optional().default(true).describe('Whether to include a screenshot in the response (default true). Set to false to save context window space when you don\'t need to see the screen.')
    },
    async ({ duration_frames, include_screenshot }): Promise<CallToolResult> => {
      // Use async wait to prevent server blocking
      await emulatorService.waitFramesAsync(duration_frames);
      if (include_screenshot) {
        const screen = emulatorService.advanceFrameAndGetScreen();
        return { content: [screen] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ waited_frames: duration_frames }) }] };
    }
  );

  // Register load ROM tool
  server.tool(
    'load_rom',
    'Load an SNES ROM file',
    {
      romPath: z.string().describe('Path to the .smc or .sfc ROM file')
    },
    async ({ romPath }): Promise<CallToolResult> => {
      const screen = emulatorService.loadRom(romPath);
      return { content: [screen] };
    }
  );

  // Register get screen tool
  server.tool(
    'get_screen',
    'Get the current SNES screen (advances one frame)',
    {},
    async (): Promise<CallToolResult> => {
      const screen = emulatorService.advanceFrameAndGetScreen();
      return { content: [screen] };
    }
  );

  // Register is_rom_loaded tool
  server.tool(
    'is_rom_loaded',
    'Check if a ROM is currently loaded in the emulator',
    {},
    async (): Promise<CallToolResult> => {
      const isLoaded = emulatorService.isRomLoaded();
      const romPath = emulatorService.getRomPath();

      const responseText: TextContent = {
        type: 'text',
        text: JSON.stringify({
          romLoaded: isLoaded,
          romPath: romPath || null
        })
      };

      log.verbose('Checked ROM loaded status', JSON.stringify({
        romLoaded: isLoaded,
        romPath: romPath || null
      }));

      return { content: [responseText] };
    }
  );

  // Register save_state tool
  server.tool(
    'save_state',
    'Save the current emulator state to a numbered slot (0-9)',
    {
      slot: z.number().int().min(0).max(9).optional().default(0).describe('Save slot number (0-9)')
    },
    async ({ slot }): Promise<CallToolResult> => {
      const result = emulatorService.saveState(slot);
      return { content: [result] };
    }
  );

  // Register load_state tool
  server.tool(
    'load_state',
    'Load a previously saved emulator state from a numbered slot (0-9)',
    {
      slot: z.number().int().min(0).max(9).optional().default(0).describe('Save slot number (0-9)'),
      include_screenshot: z.boolean().optional().default(true).describe('Whether to include a screenshot in the response')
    },
    async ({ slot, include_screenshot }): Promise<CallToolResult> => {
      const screen = emulatorService.loadState(slot);
      if (include_screenshot) {
        return { content: [screen] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ loaded: true, slot }) }] };
    }
  );

  // Register list_roms tool
  server.tool(
    'list_roms',
    'List all available SNES ROM files',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const romsDir = path.join(process.cwd(), 'roms');

        if (!fs.existsSync(romsDir)) {
          fs.mkdirSync(romsDir);
          log.info('Created roms directory');
        }

        const romFiles = fs.readdirSync(romsDir)
          .filter(file => file.endsWith('.smc') || file.endsWith('.sfc'))
          .map(file => ({
            name: file,
            path: path.join(romsDir, file)
          }));

        const responseText: TextContent = {
          type: 'text',
          text: JSON.stringify(romFiles)
        };

        log.verbose('Listed available ROMs', JSON.stringify({
          count: romFiles.length,
          roms: romFiles
        }));

        return { content: [responseText] };
      } catch (error) {
        log.error('Error listing ROMs:', error instanceof Error ? error.message : String(error));

        const errorText: TextContent = {
          type: 'text',
          text: JSON.stringify({
            error: 'Failed to list ROMs',
            message: error instanceof Error ? error.message : String(error)
          })
        };

        return { content: [errorText] };
      }
    }
  );

  // Register dump_ram tool
  server.tool(
    'dump_ram',
    'Dump a range of WRAM (Work RAM) for debugging',
    {
      start_address: z.number().int().min(0).max(0x1FFFF).optional().default(0).describe('Start address (0x0000 to 0x1FFFF)'),
      length: z.number().int().min(1).max(4096).optional().default(256).describe('Number of bytes to dump (max 4096)')
    },
    async ({ start_address, length }): Promise<CallToolResult> => {
      const result = emulatorService.dumpRam(start_address, length);
      return { content: [result] };
    }
  );

  // Register check_dialog_state tool
  server.tool(
    'check_dialog_state',
    'Check if a dialog box is currently active (Chrono Trigger specific)',
    {},
    async (): Promise<CallToolResult> => {
      const result = emulatorService.checkDialogState();
      return { content: [result] };
    }
  );
}
