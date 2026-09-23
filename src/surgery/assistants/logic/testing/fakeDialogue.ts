/** Banco de diálogo de prueba (propio del módulo crew) para tests y páginas de desarrollo. */
import type { DialogueBank, FaultKind } from '../../../../core/contracts';

const FAULTS: FaultKind[] = [
  'vesselCut', 'thermalNecrosis', 'plunge', 'contaminatedImplant', 'iatrogenicFissure', 'char', 'overRetraction',
  'strippedScrew', 'cordTouch', 'noTouchViolation', 'screwDropped', 'tightBandage', 'wrongPlate', 'malalignment', 'offPath',
];

export function fakeDialogue(): DialogueBank {
  const fault = {} as Record<FaultKind, string[]>;
  for (const f of FAULTS) fault[f] = [`Eso fue ${f}, doctora. Tómeselo como sugerencia.`, `Otro ${f}. Lo anoto con letra bonita.`];
  return {
    commands: {
      rodrigo: {
        kind: ['Rodrigo, ¿me ayudas con la cánula, porfa?', 'Rodri, aspira aquí cuando puedas.'],
        domina: ['Rodrigo. Cánula. Ahora.', '¡Rodrigo! ¡A la herida!'],
        firmSweet: ['Rodrigo, cánula aquí, cielo. Tú puedes.', 'Rodri, conmigo. Aspira, guapo.'],
      },
      fritz: {
        kind: ['Fritz, respira. Todo bien, ¿sí?', 'Fritzi, tranquilo, vamos bien.'],
        domina: ['Fritz. Manos quietas. YA.', '¡Fritz! ¡Atrapa a ese perro!'],
        firmSweet: ['Fritz, mírame. Despacito y firme.', 'Fritz, confío en ti. Ahora.'],
      },
      gigi: {
        kind: ['Gigi, ¿la lámpara, porfis?', 'Gigi, luz a la herida, ¿sí?'],
        domina: ['Gigi. Lámpara. Ahora.', '¡Gigi! ¡Suelta ese móvil!'],
        firmSweet: ['Gigi, luz aquí, reina. Gracias.', 'Gigi, lámpara, cariño. Ya.'],
      },
    },
    replies: {
      rodrigo: {
        kind: ['¿Ahora? Va, va…', '¡Voy, jefa!'],
        domina: ['¡SÍ, DOCTORA!', '¡Aspiración en re menor, jefa!'],
        firmSweet: ['¡Eso es rock!', '¡A la orden, jefa bonita!'],
        ignored: ['¿Eh? Tenía los cascos…', 'Un segundito…'],
      },
      fritz: {
        kind: ['V-vale… respiro.', 'Gracias, doctora…'],
        domina: ['¡S-s-sí, doctora!', '¡Ya voy! ¡Ya voy!'],
        firmSweet: ['Despacito y firme. Entendido.', 'Puedo hacerlo.'],
        ignored: ['¿Q-qué?', 'Perdón, no oí…'],
      },
      gigi: {
        kind: ['Ya voy, ya voy.', 'Okey, okey.'],
        domina: ['¡Ay! ¡Perdón, perdón!', '¡Luz lista, jefa!'],
        firmSweet: ['Luz a la herida, cielo.', '¡Hecho, doctora!'],
        ignored: ['Un segundito, que estoy en vivo…', 'Shh, que grabo…'],
      },
    },
    chaos: {
      rodrigoSolo: { speaker: 'rodrigo', start: ['¡SOLO DE GUITARRA!', '¡Este riff es para ti, Duquesa!'], end: ['Ya, ya… vuelvo.', 'Qué solo, ¿eh?'] },
      gigiSelfie: { speaker: 'gigi', start: ['¡Hola, mis huesitos! ¡Selfie cialítica!', '¡Luz de quirófano, luz de estrella!'], end: ['Ya subí la historia.', 'Listo, quedó divina.'] },
      fritzTremorSpike: { speaker: 'fritz', start: ['T-t-tornillo de 2,7… ¡no, no, no!', 'Me tiemblan hasta las pestañas…'], end: ['Ya pasó… creo.', 'Respiro, respiro…'] },
      panchitoIntrusion: { speaker: 'panchito', start: ['¡Guau guau guau!', '¡GUAU! (cono de lado)'], end: ['(Panchito se fue corriendo)', '(ladrido lejano)'] },
      valerioGaze: { speaker: 'valerio', start: ['Continúe, doctora. Yo solo observo.', 'Primum non nocere. Tómeselo como sugerencia.'], end: ['Hm.', 'Sigo mirando, aunque no lo parezca.'] },
      braulioFoil: { speaker: 'braulio', start: ['¡Ese monitor transmite en 5G! Ya lo protegí.', 'Aluminio. De nada.'], end: ['Bueno, lo quito, pero bajo protesta.', 'Si pasa algo, yo avisé.'] },
      hortensiaCall: { speaker: 'hortensia', start: ['¡Gigi, pásame con la doctora! ¿Merengue está bien?', '¡Merengue es lo único que me queda!'], end: ['Bueno… llamo en cinco minutos.', 'Dile que la quiero.'] },
    },
    valerio: {
      gaze: ['Le observo, doctora.', 'Proceda. Con técnica.'],
      praise: ['Correcto.', 'Aceptable.'],
      fault,
      phaseDone: ['Fase cerrada. Ni un aplauso, pero bien.', 'Siguiente fase. No se emocione.'],
      audit: { S: ['Impecable.'], A: ['Muy bien.'], B: ['Correcto.'], C: ['Mejorable.'], F: ['Tomo el control.'] },
      component: { T: ['Técnica.'], E: ['Estabilidad.'], H: ['Hemostasia.'], S: ['Esterilidad.'], L: ['Liderazgo.'], t: ['Tiempo.'] },
      takeover: ['Yo me encargo, doctora.'],
      finalRespect: 'Buen trabajo, doctora.',
    },
    emiliana: {
      crisis: ['Perdón, Fritz… necesito un segundo.'],
      relief: ['(sonríe)'],
      perfect: ['¡Así se hace!'],
      fault: ['Uy.'],
      start: ['Vamos, equipo.'],
      win: ['¡Lo logramos!'],
      breathing: ['Inspira…'],
    },
    partnerMessages: ['Buena niña, {nombre}. Estoy orgullosa de ti.'],
    rodrigo: { idle: ['(tararea un riff)'], groove: ['¡Esto es groove quirúrgico!', '¡Al ritmo, jefa!'] },
    fritz: { drop: ['¡No, no, no! ¡Contaminado!', '¡Perdón! ¡Se me resbaló!'], catch: ['¡Lo tengo!', '¡Atrapado!'], nervous: ['Estoy bien. Estoy bien.'] },
    gigi: { filming: ['Esto va para mis seguidores.', 'Modo documental, ¿eh?'], viral: ['¡Un millón de vistas!', '¡Somos tendencia, doctora!'], leave: ['Ay, siempre me sacan en lo mejor.', 'Voy, voy… rayos X, qué drama.'] },
    owners: {
      hortensia: { waiting: ['¿Tardará mucho?'], calm: ['Gracias, doctora.'], upset: ['¡Ay, mi Merengue!'] },
      braulio: { waiting: ['Aquí hay cámaras.'], calm: ['Bueno, confío.'], upset: ['¡Lo sabía!'] },
      generic: { waiting: ['¿Nos toca?'], calm: ['Gracias.'], upset: ['¡Oiga!'] },
    },
    cpr: { start: ['¡Paro!'], clear: ['¡Despejen!'], rosc: ['¡Pulso!'], fail: ['…'] },
    tutorialHints: {},
  };
}
