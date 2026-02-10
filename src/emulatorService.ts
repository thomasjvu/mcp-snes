import { SNESEmulator } from './snes';
import { SNESButton } from './types';
import { ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './utils/logger';
import type { WsSync } from './wsSync';

export class EmulatorService {
  private emulator: SNESEmulator;
  private wsSync?: WsSync;
  private saveSlots: Map<number, object> = new Map();

  // Command queue for smooth browser playback
  private commandQueue: Array<{ type: 'button_press' | 'wait_frames'; button?: SNESButton; durationFrames: number }> = [];
  private lastBroadcastedFrame: number = 0;

  // Performance targets (milliseconds)
  private readonly TARGET_CHUNK_TIME = 4; // Max 4ms per chunk to stay responsive
  private readonly FAST_FRAME_TIME_ESTIMATE = 0.05; // Estimated time per fast frame (no PPU)
  private readonly SLOW_FRAME_TIME_ESTIMATE = 2.0;  // Estimated time per frame with PPU
  private readonly PPU_SYNC_INTERVAL = 60; // Run full PPU frame periodically to keep video state stable

  constructor(emulator: SNESEmulator) {
    this.emulator = emulator;
    log.info('EmulatorService initialized');
  }

  /**
   * Get the command queue for browser sync
   */
  getCommandQueue(): Array<{ type: 'button_press' | 'wait_frames'; button?: SNESButton; durationFrames: number }> {
    return this.commandQueue;
  }

  /**
   * Clear the command queue
   */
  clearCommandQueue(): void {
    this.commandQueue = [];
  }

  setWsSync(wsSync: WsSync): void {
    this.wsSync = wsSync;
  }

  isRomLoaded(): boolean {
    return this.emulator.isRomLoaded();
  }

  getRomPath(): string | undefined {
    return this.emulator.getRomPath();
  }

  loadRom(romPath: string): ImageContent {
    log.info(`Attempting to load ROM: ${romPath}`);
    if (!fs.existsSync(romPath)) {
      log.error(`ROM file not found: ${romPath}`);
      throw new Error(`ROM file not found: ${romPath}`);
    }

    try {
      this.emulator.loadRom(romPath);
      log.info(`ROM loaded successfully: ${path.basename(romPath)}`);

      // Advance a few frames to initialize the screen
      for (let i = 0; i < 5; i++) {
        this.emulator.doFrame();
      }
      log.verbose('Advanced initial frames after ROM load');
      this.wsSync?.broadcastRomLoaded(5);

      return this.getScreen();
    } catch (error) {
      log.error(`Error loading ROM: ${romPath}`, error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to load ROM: ${romPath}. Reason: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  pressButton(button: SNESButton, durationFrames: number): void {
    log.debug(`Pressing button: ${button}`);
    if (!this.isRomLoaded()) {
      log.warn('Attempted to press button with no ROM loaded');
      throw new Error('No ROM loaded');
    }
    this.emulator.pressButton(button, durationFrames);
    this.wsSync?.broadcastButtonPress(button, durationFrames);
  }

  /**
   * Async button press that doesn't block the server.
   * Uses time-budgeted execution and adds command to queue for smooth browser playback.
   */
  async pressButtonAsync(button: SNESButton, durationFrames: number): Promise<void> {
    log.debug(`Pressing button async: ${button}`);
    if (!this.isRomLoaded()) {
      log.warn('Attempted to press button with no ROM loaded');
      throw new Error('No ROM loaded');
    }

    const buttonNum = this.emulator.getButtonMap()[button];

    // Add command to queue for browser sync
    this.commandQueue.push({ type: 'button_press', button, durationFrames });
    this.wsSync?.broadcastButtonPress(button, durationFrames);

    // Press the button
    this.emulator.setButtonPressed(buttonNum);

    // Process frames using time-budgeted execution
    let framesProcessed = 0;
    let lastYieldTime = performance.now();

    while (framesProcessed < durationFrames) {
      // Process frames until we hit our time budget
      const startTime = performance.now();

      while (framesProcessed < durationFrames && (performance.now() - startTime) < this.TARGET_CHUNK_TIME) {
        if (framesProcessed % this.PPU_SYNC_INTERVAL === 0) {
          this.emulator.doFrame();
        } else {
          this.emulator.doFrameFast(); // Mostly fast path, periodic full PPU sync
        }
        framesProcessed++;
      }

      // Yield control if we've been processing for a while
      const elapsed = performance.now() - lastYieldTime;
      if (elapsed > this.TARGET_CHUNK_TIME * 2) {
        await new Promise(resolve => setImmediate(resolve));
        lastYieldTime = performance.now();
      }
    }

    // Release the button
    this.emulator.setButtonReleased(buttonNum);

  }

  /** Press button on server emulator only, no broadcast (for browser-originated inputs) */
  pressButtonLocal(button: SNESButton, durationFrames: number): void {
    if (!this.isRomLoaded()) return;
    this.emulator.pressButton(button, durationFrames);
  }

  waitFrames(durationFrames: number): void {
    log.debug(`Waiting for ${durationFrames} frames`);
    if (!this.isRomLoaded()) {
      log.warn('Attempted to wait frames with no ROM loaded');
      throw new Error('No ROM loaded');
    }
    for (let i = 0; i < durationFrames; i++) {
      this.emulator.doFrame();
    }
    this.wsSync?.broadcastWaitFrames(durationFrames);
    log.verbose(`Waited ${durationFrames} frames`);
  }

  /**
   * Async wait that doesn't block the server
   * Uses time-budgeted execution and adds command to queue for smooth browser playback
   */
  async waitFramesAsync(durationFrames: number): Promise<void> {
    log.debug(`Waiting async for ${durationFrames} frames`);
    if (!this.isRomLoaded()) {
      log.warn('Attempted to wait frames with no ROM loaded');
      throw new Error('No ROM loaded');
    }

    // Add command to queue for browser sync
    this.commandQueue.push({ type: 'wait_frames', durationFrames });
    this.wsSync?.broadcastWaitFrames(durationFrames);

    // Process frames using time-budgeted execution
    let framesProcessed = 0;
    let lastYieldTime = performance.now();

    while (framesProcessed < durationFrames) {
      // Process frames until we hit our time budget
      const startTime = performance.now();

      while (framesProcessed < durationFrames && (performance.now() - startTime) < this.TARGET_CHUNK_TIME) {
        if (framesProcessed % this.PPU_SYNC_INTERVAL === 0) {
          this.emulator.doFrame();
        } else {
          this.emulator.doFrameFast(); // Mostly fast path, periodic full PPU sync
        }
        framesProcessed++;
      }

      // Yield control if we've been processing for a while
      const elapsed = performance.now() - lastYieldTime;
      if (elapsed > this.TARGET_CHUNK_TIME * 2) {
        await new Promise(resolve => setImmediate(resolve));
        lastYieldTime = performance.now();
      }
    }

    log.verbose(`Waited ${durationFrames} frames async`);
  }

  getScreen(): ImageContent {
    log.verbose('Getting current screen');
    if (!this.isRomLoaded()) {
      log.warn('Attempted to get screen with no ROM loaded');
      throw new Error('No ROM loaded');
    }
    const screenBase64 = this.emulator.getScreenAsBase64();
    const screen: ImageContent = {
      type: 'image',
      data: screenBase64,
      mimeType: 'image/png'
    };
    return screen;
  }

  /**
   * Advance one frame (with PPU) and get the screen
   * Also adds a command to queue for browser sync
   */
  advanceFrameAndGetScreen(): ImageContent {
    log.verbose('Advancing one frame and getting screen');
    if (!this.isRomLoaded()) {
      log.warn('Attempted to advance frame with no ROM loaded');
      throw new Error('No ROM loaded');
    }

    // Add command to queue for browser sync
    this.commandQueue.push({ type: 'wait_frames', durationFrames: 1 });

    this.emulator.doFrame(); // Full frame with PPU for screenshot
    this.wsSync?.broadcastAdvanceFrame();
    return this.getScreen();
  }

  saveState(slot: number): TextContent {
    if (!this.isRomLoaded()) {
      throw new Error('No ROM loaded');
    }
    const state = this.emulator.saveState();
    this.saveSlots.set(slot, state);
    const timestamp = new Date().toISOString();
    log.info(`State saved to slot ${slot} at ${timestamp}`);
    return {
      type: 'text',
      text: JSON.stringify({ saved: true, slot, timestamp })
    };
  }

  loadState(slot: number): ImageContent {
    if (!this.isRomLoaded()) {
      throw new Error('No ROM loaded');
    }
    const state = this.saveSlots.get(slot);
    if (!state) {
      throw new Error(`No save state in slot ${slot}`);
    }
    this.emulator.loadState(state);
    log.info(`State loaded from slot ${slot}`);
    // Run one frame with PPU to regenerate the screen
    this.emulator.doFrame();
    return this.getScreen();
  }

  /**
   * Dump a range of WRAM
   * @param startAddress Start address (0x0000 to 0x1FFFF)
   * @param length Number of bytes to dump
   * @returns Object with hex dump and raw bytes
   */
  dumpRam(startAddress: number = 0, length: number = 256): TextContent {
    if (!this.isRomLoaded()) {
      throw new Error('No ROM loaded');
    }

    const ram = this.emulator.dumpRam(startAddress, length);
    
    // Create hex dump
    let hexDump = '';
    for (let i = 0; i < ram.length; i += 16) {
      const lineAddr = (startAddress + i).toString(16).padStart(6, '0');
      const bytes = Array.from(ram.slice(i, i + 16))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      hexDump += `${lineAddr}: ${bytes}\n`;
    }

    return {
      type: 'text',
      text: JSON.stringify({
        startAddress: startAddress.toString(16).padStart(6, '0'),
        length: ram.length,
        hexDump: hexDump.trim(),
        bytes: Array.from(ram)
      })
    };
  }

  /**
   * Read a specific byte from RAM
   * @param address Address to read
   * @returns Byte value
   */
  readRamByte(address: number): number {
    if (!this.isRomLoaded()) {
      throw new Error('No ROM loaded');
    }
    return this.emulator.readRamByte(address);
  }

  /**
   * Check if dialog is active (for Chrono Trigger)
   * This checks specific memory locations where dialog state is stored
   * @returns Object with dialog state information
   */
  checkDialogState(): TextContent {
    if (!this.isRomLoaded()) {
      throw new Error('No ROM loaded');
    }

    // Chrono Trigger specific addresses (based on common WRAM locations)
    // These are approximate - we'll need to verify them
    const dialogActive = this.emulator.readRamByte(0x0200);  // Common dialog flag location
    const textBoxState = this.emulator.readRamByte(0x0201);  // Text box state
    const dialogType = this.emulator.readRamByte(0x0202);    // Type of dialog
    
    // Alternative locations to check
    const altDialogFlag1 = this.emulator.readRamByte(0x0A00);
    const altDialogFlag2 = this.emulator.readRamByte(0x0B00);
    const altDialogFlag3 = this.emulator.readRamByte(0x1A00);

    return {
      type: 'text',
      text: JSON.stringify({
        dialogActive: dialogActive,
        textBoxState: textBoxState,
        dialogType: dialogType,
        alternativeFlags: {
          flag1: altDialogFlag1,
          flag2: altDialogFlag2,
          flag3: altDialogFlag3
        },
        interpretation: {
          likelyDialogActive: dialogActive !== 0 || textBoxState !== 0,
          notes: "These are guessed addresses. We need to verify the actual locations."
        }
      }, null, 2)
    };
  }
}
