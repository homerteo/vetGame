/** Pruebas diagnósticas: textos, resultados (positivo/negativo) y acierto de la radiografía. Lógica pura. */
import type { ClinicCaseDef, DiagnosticTest } from '../../core/contracts';

export interface TestInfo {
  label: string;
  /** Glifo sencillo para el botón (sin emojis). */
  glyph: string;
  gesture: string;
  /** Se hace en el negatoscopio (placa) en vez de en la camilla. */
  atLightbox: boolean;
}

export const TEST_INFO: Record<DiagnosticTest, TestInfo> = {
  drawer: { label: 'Prueba del cajón', glyph: '⇆', gesture: 'Arrastra la tibia adelante y atrás', atLightbox: false },
  patella: { label: 'Palpación de rótula', glyph: '◎', gesture: 'Dibuja círculos alrededor de la rodilla', atLightbox: false },
  deepPain: { label: 'Dolor profundo', glyph: '✧', gesture: 'Mantén pulsado para pinzar el dedito', atLightbox: false },
  crepitus: { label: 'Crepitación', glyph: '∿', gesture: 'Haz circulitos pequeños sobre el hueso', atLightbox: false },
  hipPalpation: { label: 'Palpación de cadera', glyph: '↕', gesture: 'Flexiona y extiende la pata (arriba y abajo)', atLightbox: false },
  carpusStress: { label: 'Estrés del carpo', glyph: '⤓', gesture: 'Empuja la patita hacia abajo y aguanta', atLightbox: false },
  xray: { label: 'Radiografía', glyph: '▣', gesture: 'Marca la lesión con la fusta', atLightbox: true },
  thoracicXray: { label: 'Radiografía de tórax', glyph: '◫', gesture: 'Barre ambos pulmones con la lupa', atLightbox: true },
};

export interface TestResult {
  positive: boolean;
  /** Etiqueta del sello de la nota. */
  stamp: 'POSITIVO' | 'NEGATIVO' | 'NORMAL' | 'PRESENTE' | 'LESIÓN';
  note: string;
}

const RELATED: Partial<Record<DiagnosticTest, RegExp>> = {
  drawer: /cruzado/i,
  patella: /patel|r[óo]tula/i,
  crepitus: /fractur|perthes|femoral|conminut/i,
  hipPalpation: /cadera|perthes|femoral/i,
  carpusStress: /carpo|carpian/i,
};

/** ¿La prueba sale positiva en este caso? (la prueba clave siempre; las demás si encajan con el diagnóstico real). */
export function isPositive(c: ClinicCaseDef, test: DiagnosticTest): boolean {
  if (test === c.keyTest) return true;
  const dx = c.diagnosisOptions[c.correctDiagnosis] ?? '';
  const re = RELATED[test];
  return !!re && re.test(dx);
}

/** Resultado con nota kawaii para la libreta. */
export function testResult(c: ClinicCaseDef, test: DiagnosticTest, petName: string): TestResult {
  const pos = isPositive(c, test);
  switch (test) {
    case 'drawer':
      return pos
        ? { positive: true, stamp: 'POSITIVO', note: `La tibia de ${petName} se desliza como cajón de mueble barato. Cruzado roto.` }
        : { positive: false, stamp: 'NEGATIVO', note: 'Rodilla firme como contrato notarial. El cruzado está bien.' };
    case 'patella':
      return pos
        ? { positive: true, stamp: 'POSITIVO', note: '¡Plop! La rótula se sale del surco y vuelve. Luxación patelar.' }
        : { positive: false, stamp: 'NEGATIVO', note: 'La rótula se queda en su riel, muy formalita.' };
    case 'deepPain':
      return { positive: true, stamp: 'PRESENTE', note: `${petName} giró la cabeza indignado: dolor profundo conservado. ¡Buenísimo!` };
    case 'crepitus':
      return pos
        ? { positive: true, stamp: 'POSITIVO', note: 'Cruje como galleta en bolsillo. Hay crepitación ósea.' }
        : { positive: false, stamp: 'NEGATIVO', note: 'Ni un crujidito. Silencio de biblioteca.' };
    case 'hipPalpation':
      return pos
        ? { positive: true, stamp: 'POSITIVO', note: `Al extender la cadera ${petName} dice "¡auch!" en perfecto perruno.` }
        : { positive: false, stamp: 'NEGATIVO', note: 'Cadera suave como bisagra recién aceitada.' };
    case 'carpusStress':
      return pos
        ? { positive: true, stamp: 'POSITIVO', note: 'El carpo se aplana como tortilla al apoyar. Hiperextensión.' }
        : { positive: false, stamp: 'NEGATIVO', note: 'El carpo aguanta el peso con dignidad.' };
    case 'thoracicXray':
      return { positive: false, stamp: 'NORMAL', note: 'Pulmones limpios: sin neumotórax ni contusión. Se puede anestesiar.' };
    case 'xray':
      return { positive: true, stamp: 'LESIÓN', note: 'Placa tomada. Márcala en el negatoscopio con la fusta.' };
  }
}

/** Tamaño de la radiografía en "mm" (mismo espacio que la herida: 160 × 100). */
export const XRAY_W = 160;
export const XRAY_H = 100;

/**
 * ¿La marca (u, v normalizados 0..1) cae sobre la lesión?
 * El radio de la lesión se interpreta como fracción del ancho de la placa; `leniency` agranda la tolerancia.
 */
export function xrayHit(mark: { u: number; v: number }, lesion: { u: number; v: number; radius: number }, leniency = 1.25): boolean {
  const dx = (mark.u - lesion.u) * XRAY_W;
  const dy = (mark.v - lesion.v) * XRAY_H;
  return Math.hypot(dx, dy) <= lesion.radius * XRAY_W * leniency;
}

/** Pruebas de camilla y de negatoscopio del caso, en el orden de los datos. */
export function splitTests(c: ClinicCaseDef): { table: DiagnosticTest[]; lightbox: DiagnosticTest[] } {
  return {
    table: c.tests.filter((t) => !TEST_INFO[t].atLightbox),
    lightbox: c.tests.filter((t) => TEST_INFO[t].atLightbox),
  };
}

/**
 * Orden en que se muestran los diagnósticos (Fisher-Yates con `rng`): posición mostrada → índice en los datos.
 * Los datos siempre tienen el correcto primero; sin barajar, "1" sería siempre la respuesta.
 */
export function shuffledOrder(n: number, rng: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
