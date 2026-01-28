# MCP: SNES

An SNES emulator for LLMs via the Model Context Protocol (MCP).

Play SNES games through an MCP-compatible interface — load ROMs, press buttons, advance frames, and see the screen. Includes a browser UI with a nostalgic CRT TV + SNES console design and a full MCP tool API for LLM-driven gameplay.

## Features

- SNES emulation with built-in SnesJs core (no external emulator dependency)
- MCP server with stdio and SSE transports
- Browser UI with CRT TV, SNES console, and dog-bone controller layout
- Client-side 60fps rendering with Web Audio stereo sound
- Speed control (1x / 2x / 4x / 8x)
- ROM upload and management (.smc / .sfc)
- Full controller support (D-pad, A, B, X, Y, L, R, Start, Select)
- Keyboard input (Arrow keys, Z/X/A/S/Q/W, Enter, Shift)
- Automatic LoROM / HiROM detection

## Setup

```bash
npm install
npm run build
```

## Usage

### Stdio mode (default)

```bash
ROM_PATH=./roms/game.smc npm start
```

### SSE mode

```bash
ROM_PATH=./roms/game.smc npm run start-sse
```

### Development

```bash
npm run dev
```

### MCP Inspector

```bash
npm run debug
```

The web UI is available at `http://localhost:3001`.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SERVER_PORT` | Web server port | `3001` |
| `ROM_PATH` | Path to auto-load a ROM on startup | — |

## MCP Tools

| Tool | Description |
|---|---|
| `load_rom` | Load an SNES ROM file (.smc / .sfc) |
| `get_screen` | Get the current screen as a PNG image |
| `press_up/down/left/right` | Press a D-pad direction |
| `press_a/b/x/y` | Press a face button |
| `press_l/r` | Press a shoulder button |
| `press_start/select` | Press Start or Select |
| `wait_frames` | Advance emulation by N frames |
| `is_rom_loaded` | Check if a ROM is loaded |
| `list_roms` | List available ROMs in the roms/ directory |

## Keyboard Mapping

| Key | Button |
|---|---|
| Arrow keys | D-pad |
| Z | B |
| X | A |
| A | Y |
| S | X |
| Q | L |
| W | R |
| Enter | Start |
| Shift | Select |

## Project Structure

```
src/
  index.ts            # Entry point
  types.ts            # SNESButton enum, interfaces
  snes.ts             # SNES emulator wrapper
  emulatorService.ts  # Service layer
  tools.ts            # MCP tool registration
  ui.ts               # Web UI and API routes
  snes-core/          # SNES emulation core (SnesJs)
  server/
    server.ts         # MCP server factory
    stdio.ts          # Stdio transport
    sse.ts            # SSE transport
  utils/
    logger.ts         # File logger
```

## Acknowledgements

- SNES emulation core from [SnesJs](https://github.com/angelo-wf/SnesJs) by angelo-wf (MIT license)
- MCP architecture inspired by [mcp-gameboy](https://github.com/mario-andreschak/mcp-gameboy) by Mario Andreschak

## License

MIT
