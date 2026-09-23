import type { CaseDef, PlateParams, Pose2, StepParams, Vec2 } from '../core/contracts';
import { applyPose, applyPosePoly } from '../core/math';

/**
 * Herramientas de inspección de los datos: resumen en texto y dibujo SVG de la anatomía
 * con todos los objetivos de los pasos. Sirven para revisar los casos a ojo
 * (ver `src/data/tools/previewCases.mjs`) y como miniatura en pantallas de depuración.
 */

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** Resumen legible de un caso (una línea por fase y paso). */
export function caseSummary(c: CaseDef): string {
  const lines: string[] = [];
  lines.push(`#${c.index} ${c.patient.name} (${c.patient.breed}, ${c.patient.weightKg} kg) — ${c.diagnosis}`);
  lines.push(`   ${c.procedure} · dificultad ${c.difficulty} · ${c.feeHC} HC · ${c.targetTimeSec} s · rep ≥ ${c.requiredReputation}`);
  lines.push(`   Dueño: ${c.owner.name} (${c.owner.human}) · caos: ${c.chaos.join(', ') || 'ninguno'}`);
  const flags = Object.entries(c.flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (flags.length) lines.push(`   Banderas: ${flags.join(', ')}`);
  for (const ph of c.phases) {
    lines.push(`   [${ph.weight}%] ${ph.label}`);
    for (const s of ph.steps) lines.push(`       · ${s.label} — ${stepBrief(s.params)}`);
  }
  return lines.join('\n');
}

function stepBrief(p: StepParams): string {
  switch (p.type) {
    case 'incision':
      return `bisturí ${p.instrument}, capas ${p.layers.map((l) => `${l.layer}:${l.targetPressure}`).join(' ')}`;
    case 'hemostasis':
      return `${p.bleeders.map((b) => b.kind).join(', ')} · campo < ${p.targetFieldPct}%`;
    case 'retract':
      return `${p.instrument} × ${p.pairs.length} · clics ${p.idealClicks}/${p.maxClicks}`;
    case 'reduction':
      return `${p.mode} ${p.fragmentIds.join(', ')} · ±${p.tolMm} mm/${p.tolDeg}° · ${p.carmShots} rayos X`;
    case 'rotate':
      return `${p.fragmentId}: ${p.valueLabel} ${p.startValue} → ${p.targetValue} (±${p.tolValue})`;
    case 'saw':
      return `sierra ${p.kind}${p.releases?.length ? ` libera ${p.releases.join(', ')}` : ''}`;
    case 'burr':
      return `${p.instrument} ${p.layer} ${Math.round(p.requiredPct * 100)}% · ${p.label}`;
    case 'drillPins':
      return `${p.item} × ${p.spots.length} · perfil ${p.cortexProfileMm.join('/')} mm${p.fragile ? ' · frágil' : ''}`;
    case 'plate':
      return `${p.options.length} opciones, correcta ${p.correctId} (${p.holes.length} agujeros)`;
    case 'screws':
      return `${p.holes === 'plate' ? 'agujeros de la placa' : `${p.holes.length} agujeros`} · prof ${p.depthsMm.map(f1).join('/')} · largos ${p.lengthOptionsMm.join('/')}`;
    case 'pick':
      return `${p.tool}: ${p.items.length} elementos${p.removeFragmentIds?.length ? ` + retirar ${p.removeFragmentIds.join(', ')}` : ''}`;
    case 'clickTargets':
      return `${p.instrument} → ${p.targets.map((t) => t.label).join(', ')}`;
    case 'suture':
      return `capas ${p.layers.join(', ')} · cada ${p.spacingMm} mm`;
    case 'bandage':
      return `${p.turns} vueltas`;
  }
}

// ───────────────────────────── SVG ─────────────────────────────

const pts = (poly: Vec2[]) => poly.map((p) => `${f1(p.x)},${f1(p.y)}`).join(' ');
const polygon = (poly: Vec2[], style: string) => `<polygon points="${pts(poly)}" ${style}/>`;
const polyline = (poly: Vec2[], style: string) => `<polyline points="${pts(poly)}" fill="none" ${style}/>`;
const circle = (p: Vec2, r: number, style: string) => `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${r}" ${style}/>`;
const text = (p: Vec2, s: string, size = 2.2, color = '#3b2146') =>
  `<text x="${f1(p.x)}" y="${f1(p.y)}" font-size="${size}" fill="${color}" font-family="sans-serif">${s}</text>`;

function platePoly(p: PlateParams): Vec2[] {
  const hw = p.lengthMm / 2;
  const hh = p.widthMm / 2;
  return applyPosePoly(
    [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ],
    p.target,
  );
}

/**
 * Dibuja la anatomía del caso y los objetivos de los pasos.
 * `mode`: 'start' (fragmentos en su pose inicial), 'target' (pose final) o 'both'.
 */
export function caseSvg(c: CaseDef, opts: { widthPx?: number; mode?: 'start' | 'target' | 'both'; steps?: boolean } = {}): string {
  const w = opts.widthPx ?? 800;
  const mode = opts.mode ?? 'both';
  const out: string[] = [];
  const a = c.anatomy;
  out.push(`<rect x="0" y="0" width="160" height="100" fill="${a.furColor}"/>`);
  out.push(`<rect x="12" y="24" width="136" height="52" rx="10" fill="${a.skinTone}"/>`);
  out.push(polygon(a.window, 'fill="#7a1d2b" stroke="#3b0a12" stroke-width="0.4"'));
  if (a.cord) out.push(polygon(a.cord, 'fill="#f7d6e0" stroke="#c77d95" stroke-width="0.3"'));
  for (const b of a.boneStatic) out.push(polygon(b, 'fill="#f3ead2" stroke="#8a7a55" stroke-width="0.25"'));
  const fragPose = (pose: Pose2 | undefined) => pose;
  for (const fr of a.fragments) {
    const fill = fr.kind === 'graft' ? '#f5d77a' : fr.kind === 'block' ? '#efe0c0' : '#fbf3de';
    const stroke = fr.noTouch ? '#e0245e' : '#6b5a35';
    if (mode !== 'target') out.push(polygon(applyPosePoly(fr.polygon, fr.start), `fill="${fill}" stroke="${stroke}" stroke-width="0.3"`));
    const tp = fragPose(fr.target);
    if (tp && mode !== 'start') {
      const style = mode === 'both' ? 'fill="none" stroke="#2fd3a0" stroke-width="0.3" stroke-dasharray="1 0.6"' : `fill="${fill}" stroke="${stroke}" stroke-width="0.3"`;
      out.push(polygon(applyPosePoly(fr.polygon, tp), style));
    }
  }
  if (opts.steps !== false) {
    for (const ph of c.phases) {
      for (const s of ph.steps) {
        const p = s.params;
        switch (p.type) {
          case 'incision':
            out.push(polyline(p.path, 'stroke="#1c1c1c" stroke-width="0.35" stroke-dasharray="1.2 0.8"'));
            for (const h of p.vesselHazards ?? []) out.push(circle(h, 1.2, 'fill="none" stroke="#1d4ed8" stroke-width="0.35"'));
            break;
          case 'hemostasis':
            for (const b of p.bleeders) {
              const col = b.kind === 'arterial' ? '#ff1f3d' : b.kind === 'venous' ? '#5b0a1c' : '#ff8fa3';
              out.push(circle(b.pos, 1.3, `fill="${col}" stroke="#fff" stroke-width="0.25"`));
            }
            break;
          case 'retract':
            for (const pr of p.pairs) out.push(polyline([pr.a, pr.b], 'stroke="#8a8f98" stroke-width="0.6"'));
            break;
          case 'reduction':
            for (const k of p.kwireSpots ?? []) out.push(circle(k, 0.8, 'fill="#c0c7d0" stroke="#333" stroke-width="0.2"'));
            break;
          case 'rotate':
            out.push(circle(p.pivot, 1, 'fill="none" stroke="#7c3aed" stroke-width="0.4"'));
            if (p.pinSpot) out.push(circle(p.pinSpot, 0.8, 'fill="#c0c7d0" stroke="#7c3aed" stroke-width="0.25"'));
            break;
          case 'saw':
            out.push(polyline(p.path, 'stroke="#2563eb" stroke-width="0.45"'));
            break;
          case 'burr':
            out.push(polygon(p.area, 'fill="rgba(255,150,40,0.35)" stroke="#f97316" stroke-width="0.25"'));
            if (p.forbidden) out.push(polygon(p.forbidden, 'fill="none" stroke="#dc2626" stroke-width="0.3" stroke-dasharray="0.8 0.5"'));
            break;
          case 'drillPins':
            for (const sp of p.spots) out.push(circle(sp, 0.9, 'fill="#94a3b8" stroke="#0f172a" stroke-width="0.25"'));
            break;
          case 'plate':
            if (mode !== 'start') {
              out.push(polygon(platePoly(p), 'fill="rgba(170,180,195,0.75)" stroke="#475569" stroke-width="0.25"'));
              for (const h of p.holes) out.push(circle(applyPose(h, p.target), 0.9, 'fill="#1e293b"'));
            }
            break;
          case 'screws':
            if (p.holes !== 'plate') for (const h of p.holes) out.push(circle(h, 1.3, 'fill="none" stroke="#facc15" stroke-width="0.35"'));
            break;
          case 'pick':
            for (const it of p.items) out.push(circle(it.pos, it.radiusMm, 'fill="#fde68a" stroke="#a16207" stroke-width="0.2"'));
            if (p.forbidden) out.push(polygon(p.forbidden, 'fill="none" stroke="#dc2626" stroke-width="0.3" stroke-dasharray="0.8 0.5"'));
            break;
          case 'clickTargets':
            for (const t of p.targets) {
              out.push(circle(t.pos, 1, 'fill="none" stroke="#db2777" stroke-width="0.35"'));
              out.push(text({ x: t.pos.x + 1.4, y: t.pos.y - 1.2 }, t.label, 1.6, '#fff'));
            }
            break;
          case 'suture':
            break;
          case 'bandage':
            out.push(circle(p.center, p.radiusMm, 'fill="none" stroke="#a78bfa" stroke-width="0.25" stroke-dasharray="2 1"'));
            break;
        }
      }
    }
  }
  out.push(text({ x: 3, y: 5 }, `${c.index}. ${c.patient.name} — ${c.procedure}`, 3, '#fff'));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" width="${w}" height="${Math.round((w * 100) / 160)}">${out.join('')}</svg>`;
}
