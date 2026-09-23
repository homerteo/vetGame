/** Pantalla del monitor de constantes (Canvas → textura), redibujada a ~20 Hz. */
import * as THREE from 'three';
import type { VitalsSnapshot } from '../../core/contracts';
import { makeCanvas } from './canvasUtil';
import { ecgSample, pleth, vitalsLabel } from './monitorMath';

const W = 512;
const H = 320;
const TRACE_N = 300;

export interface MonitorScreen {
  readonly texture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  setVitals(v: VitalsSnapshot): void;
  update(dt: number): void;
  dispose(): void;
}

export function createMonitorScreen(): MonitorScreen {
  const { c, g } = makeCanvas(W, H);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  let v: VitalsSnapshot = {
    hr: 110,
    spo2: 98,
    map: 82,
    etco2: 38,
    tempC: 38.2,
    bloodVolumePct: 100,
    bloodLostPct: 0,
    exito: 60,
    arrest: false,
    rhythm: 'sinus',
    alarms: [],
  };
  const ecg = new Float32Array(TRACE_N);
  const spo = new Float32Array(TRACE_N);
  let head = 0;
  let acc = 0;
  let phase = 0;
  let t = 0;
  let redraw = 0;
  let beatFlash = 0;
  const pxPerSec = 110; // velocidad de barrido en muestras/s

  function draw(): void {
    g.fillStyle = '#1b0f24';
    g.fillRect(0, 0, W, H);
    // Rejilla sutil.
    g.strokeStyle = 'rgba(159,240,208,0.06)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 20) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    const traceW = 330;
    const drawTrace = (buf: Float32Array, y0: number, amp: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.shadowColor = color;
      g.shadowBlur = 8;
      g.beginPath();
      let started = false;
      for (let i = 0; i < TRACE_N; i++) {
        // Hueco de barrido delante del cabezal.
        const gap = (i - head + TRACE_N) % TRACE_N;
        if (gap < 10) {
          started = false;
          continue;
        }
        const x = 14 + (i / TRACE_N) * traceW;
        const y = y0 - buf[i] * amp;
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;
    };
    drawTrace(ecg, 110, 70, v.rhythm === 'vfib' || v.arrest ? '#ff5a7a' : '#9ff0d0');
    drawTrace(spo, 245, 55, '#8fd3ff');
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '700 15px "Nunito", system-ui, sans-serif';
    g.fillText('II', 16, 34);
    g.fillText('Pleth', 16, 176);

    // Columna de números.
    const alarmOn = (k: 'hr' | 'spo2' | 'map' | 'etco2' | 'temp') => v.alarms.includes(k) && Math.sin(t * 4) > -0.2;
    const num = (k: 'hr' | 'spo2' | 'map' | 'etco2' | 'temp', val: string, y: number, color: string, big: boolean) => {
      const l = vitalsLabel(k);
      if (alarmOn(k)) {
        g.fillStyle = 'rgba(255,46,147,0.35)';
        g.beginPath();
        g.roundRect(352, y - (big ? 56 : 40), 152, big ? 70 : 50, 10);
        g.fill();
      }
      g.fillStyle = color;
      g.font = '700 16px "Nunito", system-ui, sans-serif';
      g.fillText(`${l.name}`, 360, y - (big ? 38 : 24));
      g.font = `800 ${big ? 50 : 32}px "Baloo 2", "Nunito", system-ui, sans-serif`;
      g.fillText(val, 360, y + (big ? 8 : 6));
      g.font = '600 13px "Nunito", system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText(l.unit, 470, y - (big ? 38 : 24));
    };
    num('hr', v.arrest ? '---' : String(Math.round(v.hr)), 70, '#9ff0d0', true);
    num('spo2', String(Math.round(v.spo2)), 145, '#8fd3ff', true);
    num('map', String(Math.round(v.map)), 205, '#ff8fc7', false);
    num('etco2', String(Math.round(v.etco2)), 260, '#f5c542', false);
    num('temp', v.tempC.toFixed(1), 312, '#c8a2e8', false);
    // Corazón que late con cada QRS.
    const k = 1 + beatFlash * 0.35;
    g.save();
    g.translate(478, 64);
    g.scale(k, k);
    g.fillStyle = v.arrest ? '#555' : '#ff2e93';
    g.beginPath();
    g.moveTo(0, 8);
    g.bezierCurveTo(10, 1, 9, -9, 0, -4);
    g.bezierCurveTo(-9, -9, -10, 1, 0, 8);
    g.fill();
    g.restore();
    if (v.arrest && Math.sin(t * 5) > 0) {
      g.fillStyle = 'rgba(255,46,147,0.9)';
      g.font = '800 44px "Baloo 2", system-ui, sans-serif';
      g.fillText('¡PARO!', 110, 180);
    }
    texture.needsUpdate = true;
  }

  return {
    texture,
    canvas: c,
    setVitals(nv) {
      v = nv;
    },
    update(dt) {
      t += dt;
      const hr = v.arrest && v.rhythm !== 'vfib' ? 0 : Math.max(20, v.hr);
      acc += dt * pxPerSec;
      while (acc >= 1) {
        acc -= 1;
        const prev = phase;
        phase += hr / 60 / pxPerSec;
        const ts = t - acc / pxPerSec;
        ecg[head] = ecgSample(v.arrest && v.rhythm !== 'vfib' ? 'asystole' : v.rhythm, phase, ts);
        spo[head] = v.arrest ? 0.03 : pleth(phase - Math.floor(phase));
        if (Math.floor(prev + 0.75) !== Math.floor(phase + 0.75) && !v.arrest) beatFlash = 1;
        head = (head + 1) % TRACE_N;
      }
      beatFlash = Math.max(0, beatFlash - dt * 5);
      redraw -= dt;
      if (redraw <= 0) {
        redraw = 1 / 20;
        draw();
      }
    },
    dispose() {
      texture.dispose();
    },
  };
}
