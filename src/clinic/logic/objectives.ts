/** Objetivo actual (línea del HUD y flecha 3D). Tutorial guiado en orden; en el resto, por prioridad. Lógica pura. */
import type { AssistantId, DiagnosticTest } from '../../core/contracts';
import { ZONE_LABEL, type StationId, type ZoneId } from './layout';

export type ObjectiveTarget =
  | { kind: 'station'; id: StationId }
  | { kind: 'owner'; id: string }
  | { kind: 'panchito' }
  | null;

export interface Objective {
  id: string;
  text: string;
  target: ObjectiveTarget;
  urgent?: boolean;
}

export interface ObjectiveSnapshot {
  tutorial: boolean;
  ownerId: string;
  ownerName: string;
  petName: string;
  complaintHeard: boolean;
  /** Pruebas de camilla (o placas por tomar) aún sin hacer. */
  tablePending: DiagnosticTest[];
  /** Placas tomadas y pendientes de leer en el negatoscopio. */
  platesPending: DiagnosticTest[];
  requiredPending: DiagnosticTest[];
  diagnosed: boolean;
  minor: { id: string; name: string } | null;
  assigned: Record<AssistantId, boolean>;
  foiled: 'lightbox' | 'autoclave' | null;
  holdingPanchito: boolean;
  panchitoZone: ZoneId | null;
  hortensiaHigh: boolean;
  carryingTila: boolean;
  tilaGiven: boolean;
}

const DEVICE: Record<'lightbox' | 'autoclave', string> = { lightbox: 'negatoscopio', autoclave: 'autoclave' };

function assignObjective(s: ObjectiveSnapshot): Objective | null {
  if (!s.assigned.fritz) return { id: 'assign-fritz', text: 'Pídele a Fritz que esterilice instrumental (autoclave)', target: { kind: 'station', id: 'autoclave' } };
  if (!s.assigned.rodrigo) return { id: 'assign-rodrigo', text: 'Pon a Rodrigo a rasurar en Preparación', target: { kind: 'station', id: 'prep' } };
  if (!s.assigned.gigi) return { id: 'assign-gigi', text: 'Manda a Gigi al mostrador de consentimiento', target: { kind: 'station', id: 'consent' } };
  return null;
}

function examObjective(s: ObjectiveSnapshot): Objective | null {
  if (s.tablePending.length) {
    const n = s.tablePending.length;
    return {
      id: 'exam',
      text: `Explora a ${s.petName} en la camilla (${n} ${n === 1 ? 'prueba' : 'pruebas'} pendiente${n === 1 ? '' : 's'})`,
      target: { kind: 'station', id: 'exam' },
    };
  }
  if (s.platesPending.length) return { id: 'plates', text: 'Lee la placa en el negatoscopio', target: { kind: 'station', id: 'lightbox' } };
  return null;
}

function tilaObjective(s: ObjectiveSnapshot, text: string): Objective {
  return s.carryingTila
    ? { id: 'tila-give', text: `Dale la tila a ${s.ownerName}`, target: { kind: 'owner', id: s.ownerId } }
    : { id: 'tila-get', text, target: { kind: 'station', id: 'cooler' } };
}

export function nextObjective(s: ObjectiveSnapshot): Objective {
  const talk: Objective = { id: 'talk', text: `Habla con ${s.ownerName} en la sala de espera`, target: { kind: 'owner', id: s.ownerId } };
  const diagnose: Objective = { id: 'diagnose', text: `Explica el diagnóstico a ${s.ownerName}`, target: { kind: 'owner', id: s.ownerId } };
  const toOR: Objective = { id: 'or', text: '¡Todo listo! Ve a la puerta del quirófano', target: { kind: 'station', id: 'orDoor' } };

  // urgencias comunes
  if (s.holdingPanchito) return { id: 'carrier', text: 'Lleva a Panchito a su transportín', target: { kind: 'station', id: 'carrier' }, urgent: true };
  if (s.foiled) return { id: 'foil', text: `Quita el aluminio del ${DEVICE[s.foiled]}`, target: { kind: 'station', id: s.foiled }, urgent: true };

  if (s.tutorial) {
    if (!s.complaintHeard) return talk;
    const ex = examObjective(s);
    if (ex) return ex;
    if (s.minor) return { id: 'minor', text: `Atiende a ${s.minor.name} (mantén E)`, target: { kind: 'owner', id: s.minor.id } };
    const as = assignObjective(s);
    if (as) return as;
    if (!s.tilaGiven) return tilaObjective(s, `Sirve una tila en el garrafón para ${s.ownerName}`);
    if (!s.diagnosed) return diagnose;
    return toOR;
  }

  if (s.panchitoZone)
    return { id: 'panchito', text: `¡Panchito en ${ZONE_LABEL[s.panchitoZone]}! Acércate y placaje con Espacio`, target: { kind: 'panchito' }, urgent: true };
  if (s.hortensiaHigh) return { ...tilaObjective(s, 'Doña Hortensia va a estallar: sirve una tila'), urgent: true };
  if (!s.complaintHeard) return talk;
  if (!s.diagnosed) {
    const ex = examObjective(s);
    if (ex) return ex;
    return diagnose;
  }
  if (s.platesPending.length || s.requiredPending.length) {
    const ex = examObjective(s);
    if (ex) return ex;
  }
  const as = assignObjective(s);
  if (as) return as;
  if (s.minor) return { id: 'minor', text: `Atiende a ${s.minor.name} (mantén E)`, target: { kind: 'owner', id: s.minor.id } };
  return toOR;
}
