/**
 * AudioContext falso mínimo para pruebas en node. Registra nodos, conexiones y la
 * programación de fuentes, y valida como el navegador (rampas exponenciales a 0 lanzan).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export class FakeParam {
  value: number;
  events: Array<{ type: string; v: number; t: number }> = [];
  constructor(v = 0) {
    this.value = v;
  }
  private push(type: string, v: number, t: number) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`${type}: valor no finito (${v}, ${t})`);
    if (t < 0) throw new RangeError(`${type}: tiempo negativo`);
    this.events.push({ type, v, t });
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.push('set', v, t);
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.push('lin', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (Math.abs(v) < 1.4e-45) throw new RangeError('exponentialRamp a 0');
    return this.push('exp', v, t);
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    if (!(tc >= 0)) throw new RangeError('timeConstant inválido');
    return this.push('target', v, t);
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  cancelAndHoldAtTime(t: number) {
    return this.cancelScheduledValues(t);
  }
  setValueCurveAtTime() {
    return this;
  }
}

export class FakeNode {
  outputs: any[] = [];
  constructor(public ctx: FakeAudioContext, public kind: string) {
    ctx.nodes.push(this);
  }
  connect(dest: any) {
    if (!dest) throw new TypeError('connect sin destino');
    this.outputs.push(dest);
    return dest;
  }
  disconnect() {
    this.outputs = [];
  }
}

export class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0) {
    if (this.startAt !== null) throw new Error('InvalidStateError: start dos veces');
    if (!(t >= 0)) throw new RangeError('start con tiempo inválido');
    this.startAt = t;
  }
  stop(t = 0) {
    if (this.startAt === null) throw new Error('InvalidStateError: stop antes de start');
    if (!(t >= 0)) throw new RangeError('stop con tiempo inválido');
    this.stopAt = t;
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'osc');
  }
  setPeriodicWave() {}
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  detune = new FakeParam(0);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'buffer');
  }
}

export class FakeBuffer {
  private data: Float32Array[];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number) {
    this.data[c].set(src.subarray(0, this.length));
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate = 8000;
  baseLatency = 0.01;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  nodes: FakeNode[] = [];
  destination: FakeNode;
  constructor() {
    this.destination = new FakeNode(this, 'destination');
    FakeAudioContext.instances.push(this);
  }
  async resume() {
    if (this.state !== 'closed') this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
  createGain() {
    const n = new FakeNode(this, 'gain') as any;
    n.gain = new FakeParam(1);
    return n;
  }
  createOscillator() {
    return new FakeOscillator(this);
  }
  createBufferSource() {
    return new FakeBufferSource(this);
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new FakeBuffer(ch, len, sr);
  }
  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad') as any;
    n.type = 'lowpass';
    n.frequency = new FakeParam(350);
    n.Q = new FakeParam(1);
    n.gain = new FakeParam(0);
    n.detune = new FakeParam(0);
    return n;
  }
  createWaveShaper() {
    const n = new FakeNode(this, 'shaper') as any;
    n.curve = null;
    n.oversample = 'none';
    return n;
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'comp') as any;
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(0);
    return n;
  }
  createConvolver() {
    const n = new FakeNode(this, 'convolver') as any;
    n.buffer = null;
    n.normalize = true;
    return n;
  }
  createStereoPanner() {
    const n = new FakeNode(this, 'panner') as any;
    n.pan = new FakeParam(0);
    return n;
  }
  createAnalyser() {
    const n = new FakeNode(this, 'analyser') as any;
    n.fftSize = 2048;
    n.frequencyBinCount = 1024;
    n.getByteFrequencyData = () => {};
    n.getByteTimeDomainData = () => {};
    return n;
  }
  /** Fuentes (osc/buffer) creadas. */
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
  advance(dt: number) {
    this.currentTime += dt;
  }
}

/** Constructor tipado para inyectar en createAudioEngine. */
export const FakeAudioContextCtor = FakeAudioContext as unknown as new () => AudioContext;

/** Temporizadores manuales. */
export function manualTimers() {
  const cbs = new Map<number, () => void>();
  let id = 0;
  return {
    setInterval(cb: () => void) {
      cbs.set(++id, cb);
      return id;
    },
    clearInterval(i: unknown) {
      cbs.delete(i as number);
    },
    fire() {
      for (const cb of cbs.values()) cb();
    },
    count: () => cbs.size,
  };
}
