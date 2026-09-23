/** Números de diseño de la fase de clínica (GDD §3 Fase 1). Ajustados con las pruebas. */
export const TUNING = {
  shiftSec: 300,
  patience: {
    /** Paciencia perdida por segundo (0..100). */
    caseDrain: 0.12,
    minorDrain: 0.42,
    tutorialMult: 0.3,
    temper: { calm: 0.8, hysterical: 1, paranoid: 1, anxious: 1.2, stern: 1.3 } as Record<string, number>,
    /** Con Gigi en el mostrador de consentimiento los dueños esperan mejor. */
    consentMult: 0.65,
    /** Gigi grabando TikToks en la sala: los dueños se impacientan un poco más. */
    filmingMult: 1.15,
    tila: 30,
    minorImpatientAt: 25,
  },
  histeria: {
    base: 0.2,
    tutorialMult: 0.3,
    bark: 6,
    barkRadius: 4.5,
    xray: 18,
    technical: 30,
    tila: 35,
    absurd: 40,
    evasive: 20,
    /** Segundos de subida reducida tras la tila. */
    tilaShieldSec: 30,
    shieldMult: 0.25,
    faintSec: 15,
    afterFaint: 45,
  },
  contamination: {
    rise: 0.065,
    zoomMult: 1.6,
    decay: 0.005,
    /** Multiplicador de limpieza si el asistente trabaja en esa zona. */
    cleanerMult: 3,
  },
  team: {
    autoclaveCycleSec: 40,
    maxSets: 3,
    prepSec: 60,
    prepSecDomina: 45,
    unassignedPrepCap: 0.4,
    unassignedPrepSec: 150,
    consentSec: 25,
    /** Orden de Dómina: trabajo más rápido durante un rato. */
    dominaBoostSec: 20,
    dominaBoostMult: 1.3,
    /** Gigi tarda esto en terminar su TikTok si se lo pides amablemente mientras graba. */
    gigiFinishTikTokSec: 6,
    gigiFilmEverySec: [14, 24] as [number, number],
    gigiFilmSec: 8,
  },
  morale: {
    base: 60,
    kind: 10,
    domina: -6,
    fritzDomina: -14,
    /** Moral perdida por segundo que Gigi pasa grabando en vez de trabajar. */
    gigiFilmingPerSec: 0.08,
    /** Moral por minuto trabajado a gusto (asignación amable). */
    workingPerMin: 4,
    draggedByHortensia: -5,
  },
  emiliana: {
    concentration: 80,
    reserve: 100,
    dominaCost: 10,
    faint: 8,
    foil: 3,
    minorLeft: 4,
    slip: 2,
    /** Concentración perdida por la contaminación máxima (×). */
    contamination: 15,
    minorDone: 2,
    absurd: 4,
    minConcentration: 20,
  },
  minor: { holdSec: 3, hcMin: 20, hcMax: 40 },
  tip: { max: 40, evasiveMult: 0.5, wrongDiagnosisMult: 0.6 },
  braulio: { foilEverySec: [45, 70] as [number, number], firstFoilSec: 35, removeHoldSec: 1 },
  panchito: {
    carrierSec: [30, 45] as [number, number],
    firstEscapeSec: 12,
    runSpeed: 3.1,
    sniffSpeed: 1.1,
    zoomRadius: 0.9,
    zoomSec: [3, 5] as [number, number],
    sniffSec: [5, 8] as [number, number],
    barkEverySec: [2.5, 5] as [number, number],
    tackleRange: 1.2,
    wriggleSec: 15,
  },
  player: {
    maxSpeed: 3.4,
    accel: 13,
    decel: 9,
    slipAccelMult: 0.28,
    slipDecelMult: 0.12,
    radius: 0.34,
    dashSpeed: 7.5,
    dashSec: 0.28,
    sprawlSec: 0.45,
    dashCooldown: 0.9,
    carrySpeedMult: 0.85,
  },
};
