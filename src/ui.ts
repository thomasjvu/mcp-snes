import express, { Request, Response, RequestHandler } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { EmulatorService } from './emulatorService';
import { SNESButton } from './types';
import { log } from './utils/logger';

// Build a browser-compatible bundle of the SNES core (cached)
let snesCoreBundleCache: string | null = null;

function getSnesCoreBundle(): string {
  if (snesCoreBundleCache) return snesCoreBundleCache;

  const coreDir = path.join(__dirname, 'snes-core');
  // SnesJs files are plain globals, not CommonJS — load them in dependency order
  const moduleOrder = ['cart', 'dsp', 'spc', 'apu', 'cpu', 'pipu', 'snes'];

  // Provide helper globals that SnesJs expects
  let bundle = `(function(){\n"use strict";\n`;
  bundle += `function log(text) { console.log("[SnesJs] " + text); }\n`;
  bundle += `function getByteRep(val) { return ("0" + val.toString(16)).slice(-2).toUpperCase(); }\n`;
  bundle += `function getWordRep(val) { return ("000" + val.toString(16)).slice(-4).toUpperCase(); }\n`;
  bundle += `function getLongRep(val) { return ("00000" + val.toString(16)).slice(-6).toUpperCase(); }\n`;
  bundle += `function clearArray(arr) { for (var i = 0; i < arr.length; i++) arr[i] = 0; }\n`;
  bundle += `var Cpu, Spc, Dsp, Apu, Ppu, Cart, Snes;\n`;

  for (const mod of moduleOrder) {
    const content = fs.readFileSync(path.join(coreDir, mod + '.js'), 'utf-8');
    bundle += `// --- ${mod}.js ---\n${content}\n`;
  }

  bundle += `window.SnesCore = Snes;\n})();\n`;
  snesCoreBundleCache = bundle;
  return bundle;
}

export function setupWebUI(app: express.Application, emulatorService: EmulatorService): void {

  // Serve SNES core as a browser JS bundle
  app.get('/snes-core.js', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(getSnesCoreBundle());
  });

  // Serve the currently-loaded ROM as raw binary (for browser-side emulation)
  app.get('/api/rom-binary', (req: Request, res: Response) => {
    const romPath = emulatorService.getRomPath();
    if (!romPath) { res.status(404).send('No ROM loaded'); return; }
    const fullPath = path.resolve(romPath);
    if (!fs.existsSync(fullPath)) { res.status(404).send('ROM file not found'); return; }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(fullPath);
  });

  // Main emulator page — runs SNES client-side at 60fps with sound
  app.get('/emulator', (req: Request, res: Response) => {
    const currentRomPath = emulatorService.getRomPath();
    const romName = currentRomPath ? path.basename(currentRomPath).replace(/\.(smc|sfc)$/i, '') : 'No ROM';

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MCP-SNES</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Six+Caps&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --snes-dark: #2c2c2c;
      --snes-body: #d3d3d8;
      --snes-body-shadow: #b8b8c0;
      --snes-purple: #4b2d7f;
      --snes-purple-dark: #3a2266;
      --snes-label: #1a1a1a;
      --snes-purple-btn: #6b3fa0;
      --snes-purple-btn-active: #502d80;
      --snes-lavender: #9b8ec4;
      --crt-bezel: #3a3632;
      --crt-inner: #1a1816;
      --crt-body: #4a4540;
      --crt-body-dark: #2e2a28;
      --tv-leg: #2e2a28;
    }

    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px 0 24px;
      zoom: 0.8;
      background: linear-gradient(180deg, #1a1520 0%, #0d0a12 50%, #1a1520 100%);
      font-family: 'Press Start 2P', monospace;
      color: #eee;
      overflow-x: hidden;
    }

    /* ============ CRT TV ============ */
    .crt-tv { position: relative; }

    .tv-body {
      background: linear-gradient(180deg, var(--crt-body) 0%, var(--crt-body-dark) 100%);
      border-radius: 22px;
      padding: 28px 32px 20px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1);
      position: relative;
    }

    .tv-brand {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      font-size: 6px; color: rgba(255,255,255,0.2); letter-spacing: 4px; text-transform: uppercase;
    }

    .tv-screen-bezel {
      background: var(--crt-bezel); border-radius: 16px; padding: 16px;
      box-shadow: inset 0 4px 12px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05);
    }

    .tv-screen-inner {
      background: var(--crt-inner); border-radius: 12px; padding: 8px;
      position: relative; overflow: hidden;
    }

    .tv-screen-inner::after {
      content: ''; position: absolute; inset: 0; border-radius: 12px;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px);
      pointer-events: none; z-index: 2;
    }

    .tv-screen-inner::before {
      content: ''; position: absolute; top: -20%; left: -20%; width: 60%; height: 60%;
      background: radial-gradient(ellipse, rgba(255,255,255,0.04) 0%, transparent 70%);
      pointer-events: none; z-index: 3;
    }

    #screen {
      display: block; width: 512px; height: 480px;
      image-rendering: pixelated; image-rendering: crisp-edges;
      background-color: #000; border-radius: 8px; position: relative; z-index: 1;
    }

    .tv-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding: 0 8px; }

    .tv-power-led {
      width: 6px; height: 6px; border-radius: 50%;
      background: #333; transition: all 0.3s;
    }
    .tv-power-led.on { background: #4a0; box-shadow: 0 0 6px #4a0; animation: led-glow 2s ease-in-out infinite; }

    @keyframes led-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

    .tv-knobs { display: flex; gap: 12px; }
    .tv-knob { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #666, #333); border: 1px solid #222; }

    .tv-legs { display: flex; justify-content: space-between; padding: 0 40px; }
    .tv-leg { width: 8px; height: 24px; background: var(--tv-leg); border-radius: 0 0 3px 3px; }

    /* ============ SNES CONSOLE ============ */
    .snes-console { margin-top: -6px; position: relative; z-index: 1; }

    .snes-body {
      background: linear-gradient(180deg, var(--snes-body) 0%, var(--snes-body-shadow) 100%);
      border-radius: 12px 12px 16px 16px; padding: 10px 30px 14px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.6);
      width: 580px;
    }

    .snes-top-stripe {
      height: 6px; border-radius: 3px; margin-bottom: 6px;
      background: linear-gradient(90deg, var(--snes-purple) 0%, var(--snes-purple-dark) 50%, var(--snes-purple) 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
    }

    .snes-label-area { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .snes-logo { font-size: 10px; color: var(--snes-label); letter-spacing: 2px; font-weight: bold; }
    .snes-rom-name { font-size: 6px; color: #666; letter-spacing: 1px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .snes-controls-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }

    .snes-power-switch {
      width: 40px; height: 14px; background: linear-gradient(180deg, #888 0%, #666 100%);
      border-radius: 7px; position: relative; cursor: pointer;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
    }
    .snes-power-switch::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 16px; height: 10px; background: var(--snes-purple);
      border-radius: 5px; transition: left 0.2s;
    }
    .snes-power-switch.on::after { left: 22px; background: #6a4; }
    .snes-power-label { font-size: 5px; color: #888; letter-spacing: 1px; }

    .snes-eject-btn {
      width: 32px; height: 10px; background: linear-gradient(180deg, #999 0%, #777 100%);
      border-radius: 3px; border: none; cursor: pointer;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .snes-eject-label { font-size: 5px; color: #888; letter-spacing: 1px; }

    .snes-cart-slot {
      height: 4px; background: linear-gradient(180deg, #555 0%, #888 50%, #555 100%);
      border-radius: 2px; width: 200px; margin: 0 auto;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
    }
    .snes-bottom-stripe { height: 3px; background: var(--snes-purple); border-radius: 2px; margin-top: 6px; }

    /* ============ SETTINGS BAR ============ */
    .settings-bar {
      display: flex; align-items: center; justify-content: center; gap: 20px;
      padding: 8px 24px;
      background: rgba(30,30,30,0.85); border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.06);
      position: fixed; bottom: 16px; right: 16px; z-index: 100;
      backdrop-filter: blur(8px);
    }

    .setting-group { display: flex; align-items: center; gap: 6px; }

    .setting-btn {
      font-family: 'Press Start 2P', monospace; font-size: 6px;
      background: #333; color: #aaa; border: 1px solid #555; border-radius: 4px;
      padding: 5px 10px; cursor: pointer; letter-spacing: 1px; transition: all 0.12s;
      white-space: nowrap;
    }
    .setting-btn:hover { background: #444; color: #ddd; }
    .setting-btn.active { background: var(--snes-purple-btn); color: #fff; border-color: var(--snes-purple-btn); }
    .setting-btn.active:hover { background: #7b4fb0; }

    .setting-label { font-size: 5px; color: #666; letter-spacing: 1px; }

    .setting-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.08); }

    /* ============ SNES CONTROLLER ============ */
    .snes-controller {
      --ctrl-primary: #d1d1cf;
      --ctrl-secondary: #a7a7a5;
      --ctrl-logo: #828380;
      --ctrl-btn-default: #757573;
      /* USA (default): purple scheme */
      --ctrl-btn-a: #5c3a95;
      --ctrl-btn-b: #4b2d7f;
      --ctrl-btn-x: #8b6cc0;
      --ctrl-btn-y: #6b4fa0;
      margin-top: 16px;
      position: relative;
      width: 677px;
      height: 292px;
      overflow: visible;
    }

    /* JP/EU color scheme */
    .snes-controller.controller-jpeu {
      --ctrl-btn-a: #fa5548;
      --ctrl-btn-b: #ffd530;
      --ctrl-btn-x: #1574c9;
      --ctrl-btn-y: #00b873;
    }

    .snes-controller .sc-circle { aspect-ratio: 1; border-radius: 50%; }

    .sc-body {
      transform: scale(0.47);
      transform-origin: top left;
      width: 1440px;
      height: 620px;
      display: flex;
      justify-content: center;
      position: absolute;
      top: 0;
      left: 0;
    }

    .sc-center {
      width: 950px;
      height: 550px;
      background-color: var(--ctrl-primary);
      position: relative;
    }

    .sc-side {
      position: absolute;
      height: 620px;
      background-color: var(--ctrl-primary);
    }

    .sc-side.sc-left,
    .sc-side.sc-right {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sc-side.sc-left:after,
    .sc-side.sc-right:after {
      content: "";
      border-radius: 50%;
      aspect-ratio: 1;
    }

    .sc-side.sc-left { left: 0; }
    .sc-side.sc-left:after {
      width: 330px;
      box-shadow: inset 0px 10px 10px -10px rgba(0,0,0,0.5),
        inset 10px 0px 10px -10px rgba(0,0,0,0.5),
        10px 10px 10px -10px rgba(255,255,255,0.6);
    }

    .sc-side.sc-right { right: 0; }
    .sc-side.sc-right:after {
      background-color: var(--ctrl-secondary);
      width: 540px;
    }

    /* D-PAD */
    .sc-dpad {
      position: absolute;
      height: 240px;
      aspect-ratio: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1;
    }
    .sc-dpad:after {
      content: "";
      height: 60px;
      aspect-ratio: 1;
      position: absolute;
      border-radius: 50%;
      box-shadow: inset 10px 10px 30px -10px rgba(0,0,0,0.2),
        inset -10px -10px 30px 0px rgba(255,255,255,0.1);
    }
    .sc-dpad .sc-dpad-lr { rotate: 90deg; }

    .sc-dpad > div {
      height: 100%;
      width: 80px;
      background-color: var(--ctrl-btn-default);
      position: absolute;
      border-radius: 10px;
      display: flex;
      justify-content: center;
    }
    .sc-dpad > div:before,
    .sc-dpad > div:after {
      content: "";
      position: absolute;
      border: 25px solid transparent;
      border-top-width: 10px;
      border-bottom: 50px solid rgba(0,0,0,0.05);
    }
    .sc-dpad > div:after {
      rotate: 180deg;
      bottom: 0;
    }

    /* D-pad clickable overlay buttons */
    .sc-dpad-btn {
      position: absolute;
      background: transparent;
      border: none;
      cursor: pointer;
      z-index: 2;
    }
    .sc-dpad-btn:active, .sc-dpad-btn.pressed {
      background: rgba(0,0,0,0.15);
    }
    .sc-dpad-btn.sc-dp-up    { top: 0; left: 50%; transform: translateX(-50%); width: 80px; height: 50%; border-radius: 10px 10px 0 0; }
    .sc-dpad-btn.sc-dp-down  { bottom: 0; left: 50%; transform: translateX(-50%); width: 80px; height: 50%; border-radius: 0 0 10px 10px; }
    .sc-dpad-btn.sc-dp-left  { left: 0; top: 50%; transform: translateY(-50%); height: 80px; width: 50%; border-radius: 10px 0 0 10px; }
    .sc-dpad-btn.sc-dp-right { right: 0; top: 50%; transform: translateY(-50%); height: 80px; width: 50%; border-radius: 0 10px 10px 0; }

    /* FACE BUTTON PAIRS */
    .sc-button-pair {
      width: 310px;
      height: 140px;
      border-radius: 9999px;
      position: absolute;
      background-color: var(--ctrl-primary);
      rotate: -38deg;
      display: flex;
      gap: 60px;
      justify-content: center;
      align-items: center;
    }
    .sc-button-pair.sc-xy {
      left: 100px;
      transform-origin: 70px 70px;
    }
    .sc-button-pair.sc-ab {
      right: 100px;
      transform-origin: 240px 70px;
    }

    .sc-face-btn {
      width: 110px;
      box-shadow: 0px 0px 5px 0px rgba(0,0,0,0.8);
      border: none;
      cursor: pointer;
      font-family: 'Press Start 2P', monospace;
      font-size: 22px;
      color: rgba(255,255,255,0.85);
      text-shadow: 0 2px 3px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sc-face-btn:active, .sc-face-btn.pressed {
      box-shadow: inset 0 0 10px 2px rgba(0,0,0,0.5);
    }

    .sc-face-btn.sc-btn-a { background-color: var(--ctrl-btn-a); }
    .sc-face-btn.sc-btn-b { background-color: var(--ctrl-btn-b); }
    .sc-face-btn.sc-btn-x { background-color: var(--ctrl-btn-x); }
    .sc-face-btn.sc-btn-y { background-color: var(--ctrl-btn-y); }

    /* SELECT / START */
    .sc-center > .sc-sel-start {
      z-index: 1;
      position: absolute;
      left: 315px;
      bottom: 230px;
      cursor: pointer;
    }
    .sc-center > .sc-sel-start.sc-start-btn {
      left: 475px;
    }
    .sc-center > .sc-sel-start:before {
      content: "";
      width: 110px;
      height: 30px;
      background-color: var(--ctrl-btn-default);
      border-radius: 9999px;
      rotate: -38deg;
      position: absolute;
      transform-origin: 15px;
      margin-top: 50px;
      display: block;
    }
    .sc-center > .sc-sel-start.pressed:before {
      background-color: #5a5a58;
    }
    .sc-center > .sc-sel-start:after {
      font-family: Arial, sans-serif;
      color: var(--ctrl-btn-default);
      font-size: 28px;
      font-style: italic;
      position: absolute;
      top: 100px;
      font-weight: 600;
      scale: 0.75 1;
      transform-origin: left;
      letter-spacing: 3px;
    }
    .sc-center > .sc-sel-start.sc-select-btn:after { content: "SELECT"; }
    .sc-center > .sc-sel-start.sc-start-btn:after { content: "START"; }

    /* LOGO */
    .sc-logo {
      position: absolute;
      left: 85px;
      top: 50px;
      width: 470px;
      height: 100px;
      z-index: 1;
    }
    .controller-jpeu .sc-logo {
      left: 175px;
    }
    .sc-illustration {
      width: 40px;
      aspect-ratio: 1;
      position: absolute;
      border-radius: 100%;
      background-color: var(--ctrl-logo);
      box-shadow: 38px 20px var(--ctrl-logo);
      translate: 25px 13px;
      display: none;
    }
    .controller-jpeu .sc-illustration {
      display: block;
    }
    .sc-illustration:before {
      content: "";
      width: 40px;
      aspect-ratio: 1;
      position: absolute;
      border-radius: 100%;
      background-color: var(--ctrl-primary);
      box-shadow: 38px 20px var(--ctrl-primary);
      translate: -20px 20px;
    }
    .sc-illustration:after {
      content: "";
      width: 40px;
      height: 20px;
      position: absolute;
      border-radius: 100%;
      background-color: var(--ctrl-logo);
      box-shadow: 38px 20px var(--ctrl-logo);
      translate: -24px 33px;
    }
    .sc-text:before {
      content: "SUPER NINTENDO";
      font-family: "Six Caps", sans-serif;
      color: var(--ctrl-logo);
      font-size: 78px;
      position: absolute;
      left: 190px;
      line-height: 70px;
      transform: skewX(-10deg) scaleX(1.6);
      letter-spacing: -2px;
    }
    .sc-text:after {
      content: "ENTERTAINMENT SYSTEM";
      position: absolute;
      background-color: var(--ctrl-logo);
      width: 580px;
      height: 25px;
      left: 5px;
      top: 75px;
      color: var(--ctrl-primary);
      font-size: 24px;
      line-height: 20px;
      font-family: Arial, sans-serif;
      transform: scaleX(0.6);
      letter-spacing: 13.1px;
      padding-left: 10px;
      padding-top: 3px;
      overflow: hidden;
      white-space: nowrap;
      font-style: italic;
      box-sizing: border-box;
    }

    /* SHOULDER BUTTONS (L/R) — aligned over wing centers */
    .shoulder-row {
      display: flex; justify-content: space-between;
      width: 677px; padding: 0 84px;
      position: absolute; top: 0; z-index: 2;
      box-sizing: border-box;
      pointer-events: none;
    }

    .shoulder-btn {
      width: 105px; height: 10px; border: none; cursor: pointer;
      font-size: 0; color: transparent;
      background: transparent;
      opacity: 0;
      pointer-events: auto;
    }
    .shoulder-btn:active, .shoulder-btn.pressed {
      opacity: 0;
    }

    /* BACK LINK */
    .back-link {
      margin-top: 20px; margin-bottom: 10px; font-size: 7px; color: #666;
      text-decoration: none; letter-spacing: 2px; transition: color 0.2s;
    }
    .back-link:hover { color: #aaa; }

    /* WIRES */
    .wire { width: 3px; height: 20px; background: #333; margin: 0 auto; border-radius: 2px; flex-shrink: 0; }

    .wire-grow {
      flex: 1; min-height: 30px; display: flex; justify-content: center;
    }
    .wire-grow .wire-line {
      width: 3px; background: repeating-linear-gradient(180deg, #333 0px, #333 6px, #2a2a2a 6px, #2a2a2a 8px);
      border-radius: 2px;
    }

    /* STATUS OVERLAY */
    #status-overlay {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      z-index: 10; font-size: 8px; color: #888; letter-spacing: 2px; pointer-events: none;
    }
    #status-overlay.hidden { display: none; }
  </style>
</head>
<body>
  <script src="/snes-core.js"></script>

  <!-- CRT TV -->
  <div class="crt-tv">
    <div class="tv-body">
      <div class="tv-brand">MCP-SNES</div>
      <div class="tv-screen-bezel">
        <div class="tv-screen-inner">
          <canvas id="screen" width="512" height="480"></canvas>
          <div id="status-overlay">LOADING...</div>
        </div>
      </div>
      <div class="tv-bottom">
        <div class="tv-power-led" id="power-led"></div>
        <div class="tv-knobs"><div class="tv-knob"></div><div class="tv-knob"></div></div>
      </div>
    </div>
    <div class="tv-legs"><div class="tv-leg"></div><div class="tv-leg"></div></div>
  </div>

  <div class="wire"></div>

  <!-- SNES Console -->
  <div class="snes-console">
    <div class="snes-body">
      <div class="snes-top-stripe"></div>
      <div class="snes-label-area">
        <span class="snes-logo">Super Nintendo</span>
        <span class="snes-rom-name">${romName}</span>
      </div>
      <div class="snes-controls-row">
        <div>
          <span class="snes-power-label">POWER</span>
          <div class="snes-power-switch" id="power-switch"></div>
        </div>
        <div class="snes-cart-slot"></div>
        <div>
          <span class="snes-eject-label">EJECT</span>
          <button class="snes-eject-btn" id="eject-btn"></button>
        </div>
      </div>
      <div class="snes-bottom-stripe"></div>
    </div>
  </div>

  <!-- Settings Bar -->
  <div class="settings-bar">
    <div class="setting-group">
      <button class="setting-btn active" id="btn-pause">PAUSE</button>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-group">
      <button class="setting-btn active" id="btn-mute">SOUND</button>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-group">
      <button class="setting-btn" id="btn-speed">1x</button>
    </div>
    <div class="setting-divider"></div>
    <div class="setting-group">
      <button class="setting-btn active" id="btn-region">USA</button>
    </div>
  </div>

  <div class="wire-grow"><div class="wire-line"></div></div>

  <!-- SNES Controller -->
  <div class="snes-controller">
    <div class="shoulder-row">
      <button class="shoulder-btn shoulder-l" id="btn-l"></button>
      <button class="shoulder-btn shoulder-r" id="btn-r"></button>
    </div>
    <div class="sc-body">
      <div class="sc-center">
        <div class="sc-sel-start sc-select-btn" id="btn-select"></div>
        <div class="sc-sel-start sc-start-btn" id="btn-start"></div>
        <div class="sc-logo">
          <div class="sc-illustration"></div>
          <div class="sc-text"></div>
        </div>
      </div>
      <div class="sc-side sc-left sc-circle">
        <div class="sc-dpad">
          <div class="sc-dpad-ud"></div>
          <div class="sc-dpad-lr"></div>
          <button class="sc-dpad-btn sc-dp-up" id="btn-up"></button>
          <button class="sc-dpad-btn sc-dp-down" id="btn-down"></button>
          <button class="sc-dpad-btn sc-dp-left" id="btn-left"></button>
          <button class="sc-dpad-btn sc-dp-right" id="btn-right"></button>
        </div>
      </div>
      <div class="sc-side sc-right sc-circle">
        <div class="sc-button-pair sc-xy">
          <button class="sc-face-btn sc-btn-y sc-circle" id="btn-y">Y</button>
          <button class="sc-face-btn sc-btn-x sc-circle" id="btn-x">X</button>
        </div>
        <div class="sc-button-pair sc-ab">
          <button class="sc-face-btn sc-btn-b sc-circle" id="btn-b">B</button>
          <button class="sc-face-btn sc-btn-a sc-circle" id="btn-a">A</button>
        </div>
      </div>
    </div>
  </div>

  <a class="back-link" href="/">&laquo; ROM SELECT</a>

  <script>
    // ─── SNES Button IDs ──────────────────────────────────────
    // 0=B, 1=Y, 2=Select, 3=Start, 4=Up, 5=Down, 6=Left, 7=Right, 8=A, 9=X, 10=L, 11=R
    var BTN = { B:0, Y:1, SELECT:2, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7, A:8, X:9, L:10, R:11 };

    // ─── Audio ───────────────────────────────────────────────
    var SAMPLES_PER_FRAME = 734; // ~44100/60
    var samplesL = new Float64Array(SAMPLES_PER_FRAME);
    var samplesR = new Float64Array(SAMPLES_PER_FRAME);

    var AUDIO_BUF_SIZE = 16384;
    var audioBufL = new Float32Array(AUDIO_BUF_SIZE);
    var audioBufR = new Float32Array(AUDIO_BUF_SIZE);
    var audioW = 0, audioR = 0;
    var audioCtx = null, scriptNode = null, gainNode = null;
    var soundEnabled = true;

    function initAudio() {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        scriptNode = audioCtx.createScriptProcessor(2048, 0, 2);
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;
        scriptNode.onaudioprocess = function(e) {
          var left = e.outputBuffer.getChannelData(0);
          var right = e.outputBuffer.getChannelData(1);
          for (var i = 0; i < left.length; i++) {
            if (audioR !== audioW) {
              left[i] = audioBufL[audioR];
              right[i] = audioBufR[audioR];
              audioR = (audioR + 1) % AUDIO_BUF_SIZE;
            } else {
              left[i] = 0; right[i] = 0;
            }
          }
        };
        scriptNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      } catch(e) { console.warn('Audio init failed:', e); }
    }

    function pushAudioSamples() {
      for (var i = 0; i < SAMPLES_PER_FRAME; i++) {
        var next = (audioW + 1) % AUDIO_BUF_SIZE;
        if (next === audioR) break; // buffer full
        audioBufL[audioW] = samplesL[i];
        audioBufR[audioW] = samplesR[i];
        audioW = next;
      }
    }

    function resumeAudio() {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }

    // ─── SNES Emulator ───────────────────────────────────────
    var canvas = document.getElementById('screen');
    var ctx = canvas.getContext('2d');
    var imageData = ctx.createImageData(512, 480);
    var statusOverlay = document.getElementById('status-overlay');
    var powerLed = document.getElementById('power-led');
    var powerSwitch = document.getElementById('power-switch');

    var snes = new SnesCore();

    // ─── LoROM/HiROM Detection ───────────────────────────────
    function detectHiRom(data) {
      // Strip 512-byte copier header
      if (data.length % 1024 === 512) {
        data = data.slice(512);
      }
      var loromValid = false;
      if (data.length >= 0x7FE0) {
        var cL = data[0x7FDC] | (data[0x7FDD] << 8);
        var sL = data[0x7FDE] | (data[0x7FDF] << 8);
        loromValid = ((cL + sL) & 0xFFFF) === 0xFFFF;
      }
      var hiromValid = false;
      if (data.length >= 0xFFE0) {
        var cH = data[0xFFDC] | (data[0xFFDD] << 8);
        var sH = data[0xFFDE] | (data[0xFFDF] << 8);
        hiromValid = ((cH + sH) & 0xFFFF) === 0xFFFF;
      }
      var isHirom = false;
      if (hiromValid && !loromValid) isHirom = true;
      else if (hiromValid && loromValid) {
        var hiType = data.length >= 0xFFD6 ? (data[0xFFD5] >> 4) : 0;
        isHirom = hiType === 3;
      }
      return { data: data, isHirom: isHirom };
    }

    // ─── ROM Loading ─────────────────────────────────────────
    var running = false;
    var paused = false;

    async function loadROM() {
      statusOverlay.textContent = 'LOADING ROM...';
      statusOverlay.classList.remove('hidden');
      try {
        var resp = await fetch('/api/rom-binary');
        if (!resp.ok) throw new Error('No ROM');
        var buf = await resp.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var detected = detectHiRom(bytes);
        snes.loadRom(detected.data, detected.isHirom);
        // Reset after loading so the CPU reads the reset vector from the cart
        snes.reset(true);

        // Set up audio output
        snes.setSamples(samplesL, samplesR, SAMPLES_PER_FRAME);

        running = true;
        paused = false;
        powerLed.classList.add('on');
        powerSwitch.classList.add('on');
        statusOverlay.classList.add('hidden');
        updatePauseBtn();
        initAudio();
        requestAnimationFrame(gameLoop);
      } catch(e) {
        statusOverlay.textContent = 'NO SIGNAL';
        console.error('ROM load error:', e);
      }
    }

    // ─── Game Loop (60fps) ───────────────────────────────────
    var lastTime = 0;
    var FRAME_MS = 1000 / 60;

    function gameLoop(ts) {
      requestAnimationFrame(gameLoop);
      if (!running || paused) return;
      if (ts - lastTime < FRAME_MS * 0.9) return;
      lastTime = ts - ((ts - lastTime) % FRAME_MS);
      for (var s = 0; s < speedMultiplier; s++) {
        snes.runFrame();
        snes.setSamples(samplesL, samplesR, SAMPLES_PER_FRAME);
        pushAudioSamples();
      }
      // Copy PPU internal pixel buffer into canvas imageData
      snes.setPixels(imageData.data);
      ctx.putImageData(imageData, 0, 0);
    }

    // ─── Input conflict tracking ─────────────────────────────
    var userHeldButtons = {};  // btnId -> true when user is holding
    var mcpHoldCount = {};     // btnId -> count of active MCP holds

    // Reverse map: SnesJs button ID → button name string for WebSocket
    var btnIdToName = {};
    btnIdToName[BTN.UP] = 'UP'; btnIdToName[BTN.DOWN] = 'DOWN';
    btnIdToName[BTN.LEFT] = 'LEFT'; btnIdToName[BTN.RIGHT] = 'RIGHT';
    btnIdToName[BTN.A] = 'A'; btnIdToName[BTN.B] = 'B';
    btnIdToName[BTN.X] = 'X'; btnIdToName[BTN.Y] = 'Y';
    btnIdToName[BTN.L] = 'L'; btnIdToName[BTN.R] = 'R';
    btnIdToName[BTN.START] = 'START'; btnIdToName[BTN.SELECT] = 'SELECT';

    var syncWs = null; // set by connectWs()

    function sendButtonToServer(btnId, durationFrames) {
      var name = btnIdToName[btnId];
      if (name && syncWs && syncWs.readyState === WebSocket.OPEN) {
        syncWs.send(JSON.stringify({ type: 'button_press', button: name, durationFrames: durationFrames }));
      }
    }

    // ─── Controller Input (keyboard) ─────────────────────────
    // Arrows=D-pad, Z=B, X=A, A=Y, S=X, Q=L, W=R, Enter=Start, Shift=Select
    var keyMap = {
      'ArrowUp': BTN.UP, 'ArrowDown': BTN.DOWN,
      'ArrowLeft': BTN.LEFT, 'ArrowRight': BTN.RIGHT,
      'z': BTN.B, 'Z': BTN.B,
      'x': BTN.A, 'X': BTN.A,
      'a': BTN.Y, 'A': BTN.Y,
      's': BTN.X, 'S': BTN.X,
      'q': BTN.L, 'Q': BTN.L,
      'w': BTN.R, 'W': BTN.R,
      'Enter': BTN.START,
      'Shift': BTN.SELECT
    };

    var keyBtnMap = {
      'ArrowUp': 'btn-up', 'ArrowDown': 'btn-down',
      'ArrowLeft': 'btn-left', 'ArrowRight': 'btn-right',
      'z': 'btn-b', 'Z': 'btn-b', 'x': 'btn-a', 'X': 'btn-a',
      'a': 'btn-y', 'A': 'btn-y', 's': 'btn-x', 'S': 'btn-x',
      'q': 'btn-l', 'Q': 'btn-l', 'w': 'btn-r', 'W': 'btn-r',
      'Enter': 'btn-start', 'Shift': 'btn-select'
    };

    var keyDownTime = {};  // btnId -> timestamp when key was pressed

    document.addEventListener('keydown', function(e) {
      if (e.target.tagName === 'INPUT') return;
      var btn = keyMap[e.key];
      if (btn !== undefined) {
        e.preventDefault();
        resumeAudio();
        snes.setPad1ButtonPressed(btn);
        if (!userHeldButtons[btn]) {
          keyDownTime[btn] = performance.now();
        }
        userHeldButtons[btn] = true;
        var el = document.getElementById(keyBtnMap[e.key]);
        if (el) el.classList.add('pressed');
      }
      if (e.key === 'p' || e.key === 'P') togglePause();
      if (e.key === 'm' || e.key === 'M') toggleSound();
    });

    document.addEventListener('keyup', function(e) {
      var btn = keyMap[e.key];
      if (btn !== undefined) {
        // Calculate how many frames the key was held
        var held = keyDownTime[btn] ? performance.now() - keyDownTime[btn] : 0;
        var frames = Math.max(1, Math.round(held / (1000 / 60)));
        delete keyDownTime[btn];
        sendButtonToServer(btn, frames);

        delete userHeldButtons[btn];
        if (!mcpHoldCount[btn]) {
          snes.setPad1ButtonReleased(btn);
        }
        var el = document.getElementById(keyBtnMap[e.key]);
        if (el && !mcpHoldCount[btn]) el.classList.remove('pressed');
      }
    });

    // ─── Controller Input (on-screen buttons) ────────────────
    var btnMapping = [
      ['btn-up',     BTN.UP],
      ['btn-down',   BTN.DOWN],
      ['btn-left',   BTN.LEFT],
      ['btn-right',  BTN.RIGHT],
      ['btn-a',      BTN.A],
      ['btn-b',      BTN.B],
      ['btn-x',      BTN.X],
      ['btn-y',      BTN.Y],
      ['btn-l',      BTN.L],
      ['btn-r',      BTN.R],
      ['btn-start',  BTN.START],
      ['btn-select', BTN.SELECT]
    ];

    var pointerDownTime = {};  // btnId -> timestamp

    btnMapping.forEach(function(pair) {
      var el = document.getElementById(pair[0]);
      var snesBtn = pair[1];
      el.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        resumeAudio();
        snes.setPad1ButtonPressed(snesBtn);
        pointerDownTime[snesBtn] = performance.now();
        el.classList.add('pressed');
      });
      function onRelease() {
        snes.setPad1ButtonReleased(snesBtn);
        el.classList.remove('pressed');
        var held = pointerDownTime[snesBtn] ? performance.now() - pointerDownTime[snesBtn] : 0;
        var frames = Math.max(1, Math.round(held / (1000 / 60)));
        delete pointerDownTime[snesBtn];
        sendButtonToServer(snesBtn, frames);
      }
      el.addEventListener('pointerup', onRelease);
      el.addEventListener('pointerleave', onRelease);
    });

    // ─── Settings Controls ───────────────────────────────────
    var pauseBtn = document.getElementById('btn-pause');
    var muteBtn = document.getElementById('btn-mute');
    var speedBtn = document.getElementById('btn-speed');

    function updatePauseBtn() {
      pauseBtn.textContent = paused ? 'PLAY' : 'PAUSE';
      pauseBtn.classList.toggle('active', !paused);
    }

    function togglePause() {
      paused = !paused;
      updatePauseBtn();
      if (!paused && audioCtx) audioCtx.resume();
    }

    function toggleSound() {
      soundEnabled = !soundEnabled;
      if (gainNode) gainNode.gain.value = soundEnabled ? 1.0 : 0.0;
      muteBtn.textContent = soundEnabled ? 'SOUND' : 'MUTED';
      muteBtn.classList.toggle('active', soundEnabled);
      if (soundEnabled) resumeAudio();
    }

    // Speed: 1x, 2x, 4x, 8x
    var speeds = [1, 2, 4, 8];
    var speedIndex = 0;
    var speedMultiplier = 1;

    function cycleSpeed() {
      speedIndex = (speedIndex + 1) % speeds.length;
      speedMultiplier = speeds[speedIndex];
      speedBtn.textContent = speedMultiplier + 'x';
      speedBtn.classList.toggle('active', speedMultiplier > 1);
    }

    // Region toggle: JP/EU (colored) vs USA (purple)
    var regionBtn = document.getElementById('btn-region');
    var controllerEl = document.querySelector('.snes-controller');
    var isUSA = true;

    function toggleRegion() {
      isUSA = !isUSA;
      controllerEl.classList.toggle('controller-jpeu', !isUSA);
      regionBtn.textContent = isUSA ? 'USA' : 'JP/EU';
    }

    pauseBtn.addEventListener('click', function() { resumeAudio(); togglePause(); });
    muteBtn.addEventListener('click', function() { resumeAudio(); toggleSound(); });
    speedBtn.addEventListener('click', function() { cycleSpeed(); });
    regionBtn.addEventListener('click', function() { toggleRegion(); });

    // Eject button goes back to ROM select
    document.getElementById('eject-btn').addEventListener('click', function() {
      window.location.href = '/';
    });

    // ─── WebSocket sync (MCP → browser) ─────────────────────
    var wsBtnNameToId = {
      'UP': BTN.UP, 'DOWN': BTN.DOWN, 'LEFT': BTN.LEFT, 'RIGHT': BTN.RIGHT,
      'A': BTN.A, 'B': BTN.B, 'X': BTN.X, 'Y': BTN.Y,
      'L': BTN.L, 'R': BTN.R, 'START': BTN.START, 'SELECT': BTN.SELECT
    };
    var wsBtnNameToDom = {
      'UP': 'btn-up', 'DOWN': 'btn-down', 'LEFT': 'btn-left', 'RIGHT': 'btn-right',
      'A': 'btn-a', 'B': 'btn-b', 'X': 'btn-x', 'Y': 'btn-y',
      'L': 'btn-l', 'R': 'btn-r', 'START': 'btn-start', 'SELECT': 'btn-select'
    };

    function connectWs() {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var ws = new WebSocket(proto + '//' + location.host + '/ws');
      ws.onopen = function() { syncWs = ws; };
      ws.onmessage = function(ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch(e) { return; }

        if (msg.type === 'button_press') {
          var btnId = wsBtnNameToId[msg.button];
          if (btnId === undefined) return;
          var domId = wsBtnNameToDom[msg.button];

          snes.setPad1ButtonPressed(btnId);
          mcpHoldCount[btnId] = (mcpHoldCount[btnId] || 0) + 1;
          var el = domId ? document.getElementById(domId) : null;
          if (el) el.classList.add('pressed');

          setTimeout(function() {
            mcpHoldCount[btnId]--;
            if (mcpHoldCount[btnId] <= 0) {
              delete mcpHoldCount[btnId];
              if (!userHeldButtons[btnId]) {
                snes.setPad1ButtonReleased(btnId);
                if (el) el.classList.remove('pressed');
              }
            }
          }, msg.durationFrames * (1000 / 60));
        }

        if (msg.type === 'rom_loaded') {
          loadROM();
        }
      };
      ws.onclose = function() { syncWs = null; setTimeout(connectWs, 2000); };
      ws.onerror = function() { ws.close(); };
    }
    connectWs();

    // ─── Start ───────────────────────────────────────────────
    loadROM();
  </script>
</body>
</html>`);
  });

  // ─── Server-side API routes (for MCP tools and fallback) ───

  const screenHandler: RequestHandler = (req, res) => {
    if (!emulatorService.isRomLoaded()) {
      res.status(400).send('No ROM loaded');
    } else {
      try {
        const screen = emulatorService.getScreen();
        const screenBuffer = Buffer.from(screen.data, 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.send(screenBuffer);
      } catch (error) {
        log.error('Error getting screen:', error);
        res.status(500).send('Error getting screen');
      }
    }
  };
  app.get('/screen', screenHandler);

  const advanceAndGetScreenHandler: RequestHandler = (req, res) => {
    if (!emulatorService.isRomLoaded()) {
      res.status(400).send('No ROM loaded');
    } else {
      try {
        const screen = emulatorService.advanceFrameAndGetScreen();
        const screenBuffer = Buffer.from(screen.data, 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.send(screenBuffer);
      } catch (error) {
        log.error('Error advancing frame and getting screen:', error);
        res.status(500).send('Error advancing frame and getting screen');
      }
    }
  };
  app.get('/api/advance_and_get_screen', advanceAndGetScreenHandler);

  const apiToolHandler: RequestHandler = async (req, res) => {
    const { tool, params } = req.body;
    log.info(`API /api/tool called: ${tool}`, params);

    if (!tool) {
      res.status(400).json({ error: 'Tool name is required' });
      return;
    }

    if (!emulatorService.isRomLoaded() && tool !== 'load_rom') {
      res.status(400).json({ error: 'No ROM loaded' });
      return;
    }

    try {
      let result: any;

      switch (tool) {
        case 'get_screen':
          result = emulatorService.getScreen();
          break;
        case 'load_rom':
          if (!params || !params.romPath) {
            res.status(400).json({ error: 'ROM path is required' });
            return;
          }
          result = emulatorService.loadRom(params.romPath);
          break;
        case 'wait_frames':
          const duration_frames_wait = params?.duration_frames ?? 100;
          if (typeof duration_frames_wait !== 'number' || duration_frames_wait <= 0) {
            res.status(400).json({ error: 'Invalid duration_frames' });
            return;
          }
          result = emulatorService.waitFrames(duration_frames_wait);
          break;
        default:
          if (tool.startsWith('press_')) {
            const buttonName = tool.replace('press_', '').toUpperCase();
            if (!(Object.values(SNESButton) as string[]).includes(buttonName)) {
              res.status(400).json({ error: `Invalid button: ${buttonName}` });
              return;
            }
            const duration_frames_press = params?.duration_frames ?? 25;
            if (typeof duration_frames_press !== 'number' || duration_frames_press <= 0) {
              res.status(400).json({ error: 'Invalid duration_frames for press' });
              return;
            }
            emulatorService.pressButton(buttonName as SNESButton, duration_frames_press);
            result = emulatorService.getScreen();
          } else {
            res.status(400).json({ error: `Unknown tool: ${tool}` });
            return;
          }
      }

      res.json({ content: [result] });

    } catch (error) {
      log.error(`Error calling tool ${tool} via API:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: `Failed to call tool: ${errorMessage}` });
    }
  };
  app.post('/api/tool', apiToolHandler);

  app.get('/api/roms', (req: Request, res: Response) => {
    try {
      const romsDir = path.join(process.cwd(), 'roms');
      if (!fs.existsSync(romsDir)) {
        fs.mkdirSync(romsDir);
      }
      const romFiles = fs.readdirSync(romsDir)
        .filter(file => file.endsWith('.smc') || file.endsWith('.sfc'))
        .map(file => ({
          name: file,
          path: path.join(romsDir, file)
        }));
      res.json(romFiles);
    } catch (error) {
      log.error('Error getting ROM list:', error);
      res.status(500).json({ error: 'Failed to get ROM list' });
    }
  });

  app.get('/api/status', (req: Request, res: Response) => {
    try {
      const romLoaded = emulatorService.isRomLoaded();
      res.json({
        connected: true,
        romLoaded,
        romPath: emulatorService.getRomPath()
      });
    } catch (error) {
      log.error('Error checking status:', error);
      res.status(500).json({ error: 'Failed to check status' });
    }
  });
}

export function setupRomSelectionUI(app: express.Application, emulatorService: EmulatorService): void {

  // Serve cover art images from covers/ directory
  const coversDir = path.join(process.cwd(), 'covers');
  if (!fs.existsSync(coversDir)) {
    fs.mkdirSync(coversDir, { recursive: true });
  }
  app.use('/covers', express.static(coversDir));

  // Find cover image for a ROM base name
  function findCover(baseName: string): string | null {
    const exts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    for (const ext of exts) {
      if (fs.existsSync(path.join(coversDir, baseName + ext))) {
        return baseName + ext;
      }
    }
    return null;
  }

  app.get('/', (req: Request, res: Response) => {
    const romsDir = path.join(process.cwd(), 'roms');
    let romFiles: { name: string; path: string; displayName: string; cover: string | null }[] = [];
    try {
      if (!fs.existsSync(romsDir)) {
        fs.mkdirSync(romsDir);
      }
      romFiles = fs.readdirSync(romsDir)
        .filter(file => file.endsWith('.smc') || file.endsWith('.sfc'))
        .map(file => {
          const displayName = file.replace(/\.(smc|sfc)$/i, '');
          return {
            name: file,
            path: path.join('roms', file),
            displayName,
            cover: findCover(displayName)
          };
        });
    } catch (error) {
      log.error("Error reading ROM directory:", error);
    }

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MCP: SNES - ROM Select</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      display: flex; flex-direction: column; align-items: center;
      min-height: 100vh; margin: 0;
      background: linear-gradient(180deg, #1a1520 0%, #0d0a12 50%, #1a1520 100%);
      font-family: 'Press Start 2P', monospace; color: #eee; padding: 40px 20px;
    }

    /* === Page Header === */
    .page-header { text-align: center; margin-bottom: 40px; }
    .page-title { font-size: 18px; letter-spacing: 4px; color: #ddd; margin-bottom: 8px; }
    .page-subtitle { font-size: 7px; letter-spacing: 4px; color: #666; }

    /* === Cartridge Gallery === */
    .cart-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 50px 30px;
      max-width: 900px;
      width: 100%;
      padding: 0 10px;
      margin-bottom: 40px;
    }

    .cart-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      transition: transform 0.2s, filter 0.2s;
    }
    .cart-item:hover { transform: translateY(-6px) scale(1.03); filter: brightness(1.1); }
    .cart-item:active { transform: translateY(-2px) scale(1.0); }

    /* === Individual SNES Cartridge === */
    .cartridge {
      background-color: #e5e5e5;
      width: 240px;
      height: 170px;
      border: 1px solid #b0b0b0;
      border-radius: 5px 5px 2px 2px;
      display: flex;
      position: relative;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    }

    /* Bottom connector */
    .cartridge::after {
      content: '';
      position: absolute;
      bottom: -10px; left: 50%; transform: translateX(-50%);
      width: 70px; height: 10px;
      background: linear-gradient(180deg, #d0d0d0, #b8b8b8);
      border-radius: 0 0 3px 3px;
      border: 1px solid #a0a0a0; border-top: none;
    }

    /* Left section */
    .section-left {
      width: 14%;
      border-right: 1px solid #c0c0c0;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 10px 0 12px;
    }
    .lines-left { display: flex; flex-direction: column; gap: 3px; }
    .line-left {
      background-color: #a5a2a2;
      height: 3px; width: 30%;
      border-radius: 0 8px 8px 0;
      box-shadow: 1px -1px 2px rgba(0,0,0,0.3);
    }
    .screw-left {
      width: 8px; height: 8px; border-radius: 50%;
      background: radial-gradient(circle at 45% 40%, #c8c8c8, #888);
      margin-left: 6px;
      box-shadow: -1px -1px 2px rgba(0,0,0,0.4);
    }

    /* Center section */
    .section-center {
      position: relative;
      width: 72%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding-bottom: 10px;
    }

    /* Label panel — overhangs sides */
    .img-panel {
      position: absolute;
      top: 4%;
      left: -7%;
      width: 114%;
      height: 60%;
      border-radius: 6px;
      overflow: hidden;
      background: #111;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .img-panel img {
      width: 100%; height: 100%;
      object-fit: fill;
      display: block;
    }

    /* Fallback when no cover art */
    .cart-fallback {
      display: none;
      align-items: center;
      justify-content: center;
      text-align: center;
      width: 100%; height: 100%;
      padding: 12px;
      font-size: 7px;
      color: #aaa;
      letter-spacing: 1px;
      line-height: 1.6;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    }
    .cart-fallback.visible { display: flex; }

    /* Slider bar at bottom of cartridge */
    .slider-center {
      background-color: #a5a2a2;
      width: 70%; height: 8px;
      border-radius: 12px;
      box-shadow: -1px -1px 2px rgba(0,0,0,0.4);
      display: flex; z-index: 1;
    }
    .inner-slider { flex: 1; }
    .inner-slider.s2 {
      border-left: 1px solid #8a8a8a;
      border-right: 1px solid #8a8a8a;
      box-shadow: inset 10px 0 10px -14px rgba(0,0,0,0.5), inset -10px 0 10px -14px rgba(0,0,0,0.5);
    }

    /* Right section */
    .section-right {
      width: 14%;
      border-left: 1px solid #c0c0c0;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-end;
      padding: 10px 0 12px;
    }
    .lines-right { display: flex; flex-direction: column; gap: 3px; align-items: flex-end; }
    .line-right {
      background-color: #a5a2a2;
      height: 3px; width: 30%;
      border-radius: 8px 0 0 8px;
      box-shadow: -1px -1px 2px rgba(0,0,0,0.3);
    }
    .screw-right {
      width: 8px; height: 8px; border-radius: 50%;
      background: radial-gradient(circle at 45% 40%, #c8c8c8, #888);
      margin-right: 6px;
      box-shadow: -1px -1px 2px rgba(0,0,0,0.4);
    }

    /* ROM name below cartridge */
    .cart-name {
      margin-top: 18px;
      font-size: 6px;
      color: #aaa;
      letter-spacing: 1px;
      text-align: center;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* No ROMs message */
    .no-roms {
      text-align: center; font-size: 8px; color: #666;
      padding: 40px; line-height: 2.2; letter-spacing: 1px;
      grid-column: 1 / -1;
    }

    /* Upload area */
    .upload-area {
      border: 2px dashed #444; border-radius: 8px;
      padding: 20px; text-align: center;
      max-width: 500px; width: 100%;
      transition: border-color 0.2s;
    }
    .upload-area:hover { border-color: #666; }
    .upload-area form { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .upload-label { font-size: 6px; color: #888; letter-spacing: 3px; }
    .upload-area input[type="file"] { font-family: 'Press Start 2P', monospace; font-size: 6px; color: #ccc; }
    .upload-btn {
      font-family: 'Press Start 2P', monospace; font-size: 7px; background: #4b2d7f; color: #fff;
      border: none; border-radius: 4px; padding: 8px 20px; cursor: pointer;
      letter-spacing: 2px; transition: background 0.15s;
    }
    .upload-btn:hover { background: #5c3a95; }
    .upload-btn:active { background: #3a2266; }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="page-title">MCP: SNES</div>
    <div class="page-subtitle">SELECT ROM CARTRIDGE</div>
  </div>

  <div class="cart-gallery">
    ${romFiles.length > 0
      ? romFiles.map(rom => `
        <div class="cart-item" onclick="selectRom('${rom.path.replace(/\\/g, '\\\\')}')">
          <div class="cartridge">
            <div class="section-left">
              <div class="lines-left">
                <div class="line-left"></div><div class="line-left"></div><div class="line-left"></div><div class="line-left"></div><div class="line-left"></div>
              </div>
              <div class="screw-left"></div>
            </div>
            <div class="section-center">
              <div class="img-panel">
                ${rom.cover
                  ? `<img src="/covers/${rom.cover}" onerror="this.style.display='none';this.nextElementSibling.classList.add('visible');" /><div class="cart-fallback">${rom.displayName}</div>`
                  : `<div class="cart-fallback visible">${rom.displayName}</div>`
                }
              </div>
              <div class="slider-center">
                <div class="inner-slider s1"></div><div class="inner-slider s2"></div><div class="inner-slider s3"></div>
              </div>
            </div>
            <div class="section-right">
              <div class="lines-right">
                <div class="line-right"></div><div class="line-right"></div><div class="line-right"></div><div class="line-right"></div><div class="line-right"></div>
              </div>
              <div class="screw-right"></div>
            </div>
          </div>
          <div class="cart-name">${rom.displayName}</div>
        </div>`).join('')
      : '<p class="no-roms">No ROM files found.<br><br>Upload a .smc or .sfc file below.</p>'
    }
  </div>

  <div class="upload-area">
    <form action="/upload" method="post" enctype="multipart/form-data">
      <span class="upload-label">UPLOAD ROM</span>
      <input type="file" name="rom" accept=".smc,.sfc" required />
      <button type="submit" class="upload-btn">INSERT</button>
    </form>
  </div>

  <script>
    function selectRom(romPath) {
      window.location.href = '/snes?rom=' + encodeURIComponent(romPath);
    }
  </script>
</body>
</html>`);
  });
}
