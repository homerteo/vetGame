import type { InstrumentId, InstrumentInfo } from '../core/contracts';

/** Instrumental quirúrgico: nombre, etiqueta corta de ranura (≤ 10 caracteres) y descripción. */
export const INSTRUMENTS: Record<InstrumentId, InstrumentInfo> = {
  scalpel10: {
    id: 'scalpel10',
    name: 'Bisturí n.º 10',
    short: 'Bisturí 10',
    description: 'Hoja curva y generosa para incisiones largas. La rueda del ratón controla la presión.',
  },
  scalpel15: {
    id: 'scalpel15',
    name: 'Bisturí n.º 15',
    short: 'Bisturí 15',
    description: 'Hoja pequeña de precisión para pacientes diminutos y cortes finos.',
  },
  cautery: {
    id: 'cautery',
    name: 'Electrocauterio bipolar',
    short: 'Cauterio',
    description: 'Sella vasos con 1–2 s de contacto. Más de 3 s: carbón, humo y la ceja levantada de Valerio.',
  },
  gelpi: {
    id: 'gelpi',
    name: 'Separador de Gelpi',
    short: 'Gelpi',
    description: 'Separador autoestático de puntas finas. Abre por clics de trinquete; no te pases.',
  },
  weitlaner: {
    id: 'weitlaner',
    name: 'Separador de Weitlaner',
    short: 'Weitlaner',
    description: 'Separador autoestático con dientes romos, ideal para masas musculares.',
  },
  kern: {
    id: 'kern',
    name: 'Pinzas de reducción de Kern',
    short: 'Kern',
    description: 'Agarran el hueso con firmeza: arrastra y gira con Q/E hasta la silueta fantasma.',
  },
  drill: {
    id: 'drill',
    name: 'Taladro quirúrgico',
    short: 'Taladro',
    description: 'Dosifica con el clic. Por encima de 47 °C el hueso sufre: paciencia e irrigación.',
  },
  saw: {
    id: 'saw',
    name: 'Sierra ósea',
    short: 'Sierra',
    description: 'Oscilante, fina o birradial. Pasadas cortas y la tecla I para irrigar.',
  },
  burr: {
    id: 'burr',
    name: 'Fresa neumática',
    short: 'Fresa',
    description: 'Retira hueso capa a capa. Cerca de la médula, respira dos veces antes de apoyar.',
  },
  plate: {
    id: 'plate',
    name: 'Placa bloqueada',
    short: 'Placa',
    description: 'Elige el tamaño, contornéala con las dobladoras y apóyala sobre el hueso.',
  },
  screwdriver: {
    id: 'screwdriver',
    name: 'Destornillador con limitador de torque',
    short: 'Tornillos',
    description: 'Atrapa el tornillo de Fritz, mide y atornilla hasta el clic. Ni un cuarto de vuelta más.',
  },
  needleHolder: {
    id: 'needleHolder',
    name: 'Porta-agujas',
    short: 'Porta',
    description: 'Semicírculos que cruzan la incisión a intervalos parejos. Nudo firme, nunca estrangulado.',
  },
  bandage: {
    id: 'bandage',
    name: 'Venda cohesiva',
    short: 'Venda',
    description: 'Círculos con tensión pareja. Apretada de más = deditos hinchados como salchichas.',
  },
  kwire: {
    id: 'kwire',
    name: 'Aguja de Kirschner',
    short: 'Kirschner',
    description: 'Aguja lisa para fijar temporalmente un fragmento ya reducido.',
  },
  forceps: {
    id: 'forceps',
    name: 'Pinzas de disección',
    short: 'Pinzas',
    description: 'Para extraer material discal y esquirlas con delicadeza de relojero.',
  },
  rasp: {
    id: 'rasp',
    name: 'Raspa ósea',
    short: 'Raspa',
    description: 'Alisa los bordes del hueso cortado. Ras, ras, ras: pura terapia.',
  },
  carm: {
    id: 'carm',
    name: 'Arco en C (rayos X)',
    short: 'Rayos X',
    description: 'Radiografía instantánea con la tecla R. Cada disparo suma dosis y Gigi debe salir.',
  },
  hand: {
    id: 'hand',
    name: 'Mano enguantada',
    short: 'Mano',
    description: 'Para montar abrazaderas, sujetar tejidos y dar palmaditas de ánimo al equipo.',
  },
};
