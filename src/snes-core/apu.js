
function Apu(snes) {

  this.snes = snes;

  this.spc = new Spc(this);
  this.dsp = new Dsp(this);

  this.bootRom = new Uint8Array([
    0xcd, 0xef, 0xbd, 0xe8, 0x00, 0xc6, 0x1d, 0xd0, 0xfc, 0x8f, 0xaa, 0xf4, 0x8f, 0xbb, 0xf5, 0x78,
    0xcc, 0xf4, 0xd0, 0xfb, 0x2f, 0x19, 0xeb, 0xf4, 0xd0, 0xfc, 0x7e, 0xf4, 0xd0, 0x0b, 0xe4, 0xf5,
    0xcb, 0xf4, 0xd7, 0x00, 0xfc, 0xd0, 0xf3, 0xab, 0x01, 0x10, 0xef, 0x7e, 0xf4, 0x10, 0xeb, 0xba,
    0xf6, 0xda, 0x00, 0xba, 0xf4, 0xc4, 0xf4, 0xdd, 0x5d, 0xd0, 0xdb, 0x1f, 0x00, 0x00, 0xc0, 0xff
  ]);

  this.ram = new Uint8Array(0x10000);

  this.spcWritePorts = new Uint8Array(4);
  this.spcReadPorts = new Uint8Array(6); // includes 2 bytes of 'ram'

  this.reset = function() {
    clearArray(this.ram);
    clearArray(this.spcWritePorts);
    clearArray(this.spcReadPorts);

    this.dspAdr = 0;
    this.dspRomReadable = true;

    this.spc.reset();
    this.dsp.reset();

    this.cycles = 0;

    // timers
    this.timer1int = 0;
    this.timer1div = 0;
    this.timer1target = 0;
    this.timer1counter = 0;
    this.timer1enabled = false;
    this.timer2int = 0;
    this.timer2div = 0;
    this.timer2target = 0;
    this.timer2counter = 0;
    this.timer2enabled = false;
    this.timer3int = 0;
    this.timer3div = 0;
    this.timer3target = 0;
    this.timer3counter = 0;
    this.timer3enabled = false;
  }
  this.reset();

  this.getState = function() {
    return {
      ram: Array.from(this.ram),
      spcWritePorts: Array.from(this.spcWritePorts),
      spcReadPorts: Array.from(this.spcReadPorts),
      dspAdr: this.dspAdr, dspRomReadable: this.dspRomReadable,
      cycles: this.cycles,
      timer1int: this.timer1int, timer1div: this.timer1div,
      timer1target: this.timer1target, timer1counter: this.timer1counter,
      timer1enabled: this.timer1enabled,
      timer2int: this.timer2int, timer2div: this.timer2div,
      timer2target: this.timer2target, timer2counter: this.timer2counter,
      timer2enabled: this.timer2enabled,
      timer3int: this.timer3int, timer3div: this.timer3div,
      timer3target: this.timer3target, timer3counter: this.timer3counter,
      timer3enabled: this.timer3enabled,
      spc: this.spc.getState(),
      dsp: this.dsp.getState()
    };
  }

  this.setState = function(s) {
    var i;
    for(i = 0; i < s.ram.length; i++) this.ram[i] = s.ram[i];
    for(i = 0; i < s.spcWritePorts.length; i++) this.spcWritePorts[i] = s.spcWritePorts[i];
    for(i = 0; i < s.spcReadPorts.length; i++) this.spcReadPorts[i] = s.spcReadPorts[i];
    this.dspAdr = s.dspAdr; this.dspRomReadable = s.dspRomReadable;
    this.cycles = s.cycles;
    this.timer1int = s.timer1int; this.timer1div = s.timer1div;
    this.timer1target = s.timer1target; this.timer1counter = s.timer1counter;
    this.timer1enabled = s.timer1enabled;
    this.timer2int = s.timer2int; this.timer2div = s.timer2div;
    this.timer2target = s.timer2target; this.timer2counter = s.timer2counter;
    this.timer2enabled = s.timer2enabled;
    this.timer3int = s.timer3int; this.timer3div = s.timer3div;
    this.timer3target = s.timer3target; this.timer3counter = s.timer3counter;
    this.timer3enabled = s.timer3enabled;
    this.spc.setState(s.spc);
    this.dsp.setState(s.dsp);
  }

  this.cycle = function() {
    this.spc.cycle();

    if((this.cycles & 0x1f) === 0) {
      // every 32 cycles
      this.dsp.cycle();
    }

    // run the timers
    if(this.timer1int === 0) {
      this.timer1int = 128;
      if(this.timer1enabled) {
        this.timer1div++;
        this.timer1div &= 0xff;
        if(this.timer1div === this.timer1target) {
          this.timer1div = 0;
          this.timer1counter++;
          this.timer1counter &= 0xf;
        }
      }
    }
    this.timer1int--;

    if(this.timer2int === 0) {
      this.timer2int = 128;
      if(this.timer2enabled) {
        this.timer2div++;
        this.timer2div &= 0xff;
        if(this.timer2div === this.timer2target) {
          this.timer2div = 0;
          this.timer2counter++;
          this.timer2counter &= 0xf;
        }
      }
    }
    this.timer2int--;

    if(this.timer3int === 0) {
      this.timer3int = 16;
      if(this.timer3enabled) {
        this.timer3div++;
        this.timer3div &= 0xff;
        if(this.timer3div === this.timer3target) {
          this.timer3div = 0;
          this.timer3counter++;
          this.timer3counter &= 0xf;
        }
      }
    }
    this.timer3int--;

    this.cycles++;
  }

  this.read = function(adr) {
    adr &= 0xffff;

    switch(adr) {
      case 0xf0:
      case 0xf1:
      case 0xfa:
      case 0xfb:
      case 0xfc: {
        // not readable
        return 0;
      }
      case 0xf2: {
        return this.dspAdr;
      }
      case 0xf3: {
        return this.dsp.read(this.dspAdr & 0x7f);
      }
      case 0xf4:
      case 0xf5:
      case 0xf6:
      case 0xf7:
      case 0xf8:
      case 0xf9: {
        return this.spcReadPorts[adr - 0xf4];
      }
      case 0xfd: {
        let val = this.timer1counter;
        this.timer1counter = 0;
        return val;
      }
      case 0xfe: {
        let val = this.timer2counter;
        this.timer2counter = 0;
        return val;
      }
      case 0xff: {
        let val = this.timer3counter;
        this.timer3counter = 0;
        return val;
      }
    }

    if(adr >= 0xffc0 && this.dspRomReadable) {
      return this.bootRom[adr & 0x3f];
    }

    return this.ram[adr];
  }

  this.write = function(adr, value) {
    adr &= 0xffff;

    switch(adr) {
      case 0xf0: {
        // test register, not emulated
        break;
      }
      case 0xf1: {
        if(!this.timer1enabled && (value & 0x01) > 0) {
          this.timer1div = 0;
          this.timer1counter = 0;
        }
        if(!this.timer2enabled && (value & 0x02) > 0) {
          this.timer2div = 0;
          this.timer2counter = 0;
        }
        if(!this.timer3enabled && (value & 0x04) > 0) {
          this.timer3div = 0;
          this.timer3counter = 0;
        }
        this.timer1enabled = (value & 0x01) > 0;
        this.timer2enabled = (value & 0x02) > 0;
        this.timer3enabled = (value & 0x04) > 0;
        this.dspRomReadable = (value & 0x80) > 0;
        if((value & 0x10) > 0) {
          this.spcReadPorts[0] = 0;
          this.spcReadPorts[1] = 0;
        }
        if((value & 0x20) > 0) {
          this.spcReadPorts[2] = 0;
          this.spcReadPorts[3] = 0;
        }
        break;
      }
      case 0xf2: {
        this.dspAdr = value;
        break;
      }
      case 0xf3: {
        if(this.dspAdr < 0x80) {
          this.dsp.write(this.dspAdr, value);
        }
        break;
      }
      case 0xf4:
      case 0xf5:
      case 0xf6:
      case 0xf7: {
        this.spcWritePorts[adr - 0xf4] = value;
        break;
      }
      case 0xf8:
      case 0xf9: {
        this.spcReadPorts[adr - 0xf4] = value;
      }
      case 0xfa: {
        this.timer1target = value;
        break;
      }
      case 0xfb: {
        this.timer2target = value;
        break;
      }
      case 0xfc: {
        this.timer3target = value;
        break;
      }
    }

    this.ram[adr] = value;
  }

  this.setSamples = function(left, right, sampleCount) {
    let add = 534 / sampleCount;
    let total = 0;
    for(let i = 0; i < sampleCount; i++) {
      left[i] =  this.dsp.samplesL[total & 0xffff];
      right[i] =  this.dsp.samplesR[total & 0xffff];
      total += add;
    }
    this.dsp.sampleOffset = 0;
  }
}
