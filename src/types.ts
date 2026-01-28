import {
  ImageContent,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';

// SNES button types
export enum SNESButton {
  UP = 'UP',
  DOWN = 'DOWN',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  A = 'A',
  B = 'B',
  X = 'X',
  Y = 'Y',
  L = 'L',
  R = 'R',
  START = 'START',
  SELECT = 'SELECT'
}

// SnesJs button number mapping
// 0=B, 1=Y, 2=Select, 3=Start, 4=Up, 5=Down, 6=Left, 7=Right, 8=A, 9=X, 10=L, 11=R
export const SNES_BUTTON_MAP: Record<SNESButton, number> = {
  [SNESButton.B]: 0,
  [SNESButton.Y]: 1,
  [SNESButton.SELECT]: 2,
  [SNESButton.START]: 3,
  [SNESButton.UP]: 4,
  [SNESButton.DOWN]: 5,
  [SNESButton.LEFT]: 6,
  [SNESButton.RIGHT]: 7,
  [SNESButton.A]: 8,
  [SNESButton.X]: 9,
  [SNESButton.L]: 10,
  [SNESButton.R]: 11
};

// Tool schemas
export interface PressButtonToolSchema {
  button: SNESButton;
  duration_frames?: number;
}

export interface WaitFramesToolSchema {
  duration_frames: number;
}

export interface LoadRomToolSchema {
  romPath: string;
}

export interface GetScreenToolSchema {
  // No parameters needed
}

// Server configuration
export interface SNESServerConfig {
  romPath?: string;
  port?: number;
}

// Session state
export interface SNESSession {
  romLoaded: boolean;
  romPath?: string;
}
