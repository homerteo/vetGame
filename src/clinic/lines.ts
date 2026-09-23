/** Frases propias de la clínica (complementan deps.dialogue). Cortas, cómicas y en español neutro. */
import type { AnimalModelId, HumanId } from '../core/contracts';

export const MINOR_ERRANDS: Array<{ errand: string; done: string[] }> = [
  { errand: 'corte de uñas', done: ['¡Uñas de pasarela! Ya no rayará el piso nuevo.', 'Ni una gota de sangre. Soy una artista.'] },
  { errand: 'vacuna anual', done: ['Pinchazo y premio. Ni se enteró, el valiente.', 'Vacunado y con sticker de corazón en la cartilla.'] },
  { errand: 'otitis', done: ['Oreja limpia. Encontré tres cotonetes y una uva.', 'Gotitas dos veces al día. Y nada de bañarlo en la piscina.'] },
  { errand: 'desparasitación', done: ['Pastilla escondida en jamón. Nunca falla.', 'Desparasitado. Los bichos ya buscan otro departamento.'] },
  { errand: 'revisión dental', done: ['Sarro leve. Cepíllale los dientes, que tiene aliento de dragón.', 'Dientes perfectos para sonreír en fotos.'] },
];

export const MINOR_OWNERS: Array<{ human: HumanId; name: string; pet: AnimalModelId; petName: string }> = [
  { human: 'ownerA', name: 'Doña Pili', pet: 'cat', petName: 'Michi Jagger' },
  { human: 'ownerB', name: 'Don Tacho', pet: 'dachshund', petName: 'Salchipapa' },
  { human: 'ownerC', name: 'Yoli', pet: 'rabbit', petName: 'Zanahorio' },
  { human: 'ownerB', name: 'Sr. Pepe', pet: 'bulldog', petName: 'Tamal' },
];

export const MINOR_THANKS = ['¡Gracias, doctora! Qué botas tan divinas.', '¡Qué rápida! Vuelvo el mes que viene.', 'Le dejo propina en la alcancía de hueso.'];
export const MINOR_WAITING = ['¿Falta mucho? Mi gato tiene clases de yoga.', 'Solo es una vacunita, doctora...', 'Llevo aquí desde que Valerio tenía pelo negro.'];
export const MINOR_LEFT = ['¡Me voy! ¡Aquí atienden más rápido a los chihuahuas!', 'Vuelvo otro día. O nunca. Adiós.', 'Mi conejo tiene más paciencia que yo. Y ya se le acabó.'];

export const CONSPIRACIES = [
  'Ese aparato manda mis ondas a Suiza, doctora. Lo sé.',
  'El aluminio refleja el 5G. Lo vi en un video de cuatro horas.',
  'Los rayos X son rayos Y disfrazados. Piénselo.',
  'Panchito sabe cosas. Por eso lo quieren operar.',
  '¿Por qué el autoclave pita? ¿A quién le avisa?',
  'Mi primo el astronauta me enseñó esto. Bueno, casi astronauta.',
];

export const BRAULIO_FOIL_REMOVED = ['¡Doctora, no! ¡Ahora nos escuchan!', 'Bueno, bueno... pero si llega un dron, yo avisé.', 'Está bien. Pero me quedo el aluminio, que está nuevito.'];

export const HORTENSIA_FAINT = ['¡AAAAAY! ¡Mi Merengue! ¡Sales, alguien, sales!', '¡Me desmayo! ¡Sosténganme! ¡Tú, el de la guitarra!', '¡Esto es demasiado para una madre!'];
export const HORTENSIA_XRAY = ['¿Eso es un HUESO? ¿Por dentro? ¡Qué horror, qué horror!', '¡No me enseñen el esqueleto de mi bebé!'];
export const HORTENSIA_BARK = ['¡Que se calle ese perro con embudo!', '¡Ese chihuahua me sube la presión!'];
export const HORTENSIA_TECH = ['¿Pseudo... qué? ¿Se va a MORIR? ¡Hable claro!', '¡No entendí nada y me dio más miedo!'];

export const TILA_GIVE = ['Tómese esta tila, respire conmigo. Uno, dos...', 'Tila con miel. Receta de mi abuela y de la ciencia.', 'Para usted: tilita tibia y cero preocupaciones.'];
export const TILA_THANKS = ['Ay, qué rica... ya me siento de algodón.', 'Gracias, doctora. Usted sí es un amor.', 'Mmm... ¿le puso algo? Estoy tan tranquilo.'];
export const TILA_GRAB = ['Tila lista. Que no se me caiga...', 'Taza de tila en mano. Modo mesera kawaii.'];
export const TILA_SPILL = ['¡Noooo, la tila! Otro charco. Genial.', 'Tila al piso. El piso ahora está muy relajado.'];

export const PANCHITO_BARK = ['¡Yip! ¡Yip yip!', '¡GRRR-yip!', '¡Wof! (en chihuahua: "¡libertad!")', '¡Yiiiip!'];
export const PANCHITO_ESCAPE = ['¡Panchito se escapó del transportín! Otra vez.', 'Panchito abrió la reja. Nadie sabe cómo.', 'Panchito ha salido. El cono no lo detiene.'];
export const TACKLE_OK = ['¡Te tengo, pequeño gremlin!', '¡Placaje de plataforma! ¡Toma!', 'Atrapado. No me mires así.'];
export const TACKLE_MISS = ['¡Casi! Mis botas pesan dos kilos cada una.', 'Mmm. Ese chihuahua es más rápido que el wifi.', '¡Vuelve aquí, bolita de caos!'];
export const PANCHITO_STORED = ['Adentro. Quédate ahí y piensa en lo que hiciste.', 'Transportín cerrado. Por ahora.'];
export const PANCHITO_WRIGGLE = ['¡Se escurrió como gelatina!', '¡Suelta, suelta! ¡Ay, se me fue!'];

export const SLIP = ['¡Uy! ¡Piso mojado!', '¡Wiii! No fue a propósito.', 'Estas botas no son para patinar...'];

export const ZONE_ALERT: Record<'or' | 'prep' | 'autoclave', string[]> = {
  or: ['¡Panchito está olfateando la puerta del quirófano!', '¡Zona estéril invadida por un chihuahua con cono!'],
  prep: ['¡Panchito se revolcó en los pelos rasurados!', '¡Panchito en Preparación! Adiós antisepsia.'],
  autoclave: ['¡Panchito le ladra al autoclave!', '¡Panchito se sentó sobre los paños estériles!'],
};

export const FRITZ_SET = ['J-juego estéril listo. Ni lo toqué. Bueno, un poquito no.', 'Otro juego esterilizado. ¡Pitó bonito!', 'Juego listo, doctora. Estoy temblando de orgullo.'];
export const FRITZ_FULL = ['¡Tres juegos! Ya no caben más en el carrito.', 'Máximo de juegos. Podría operar a un elefante.'];
export const RODRIGO_PREP_FULL = ['Rasurado y antisepsia de concierto, jefa. ¡Rock!', 'Piel lista. Brilla más que mi calva.'];
export const GIGI_CONSENT = ['Consentimiento firmado. Y le saqué una selfie para el recuerdo.', '¡Firmado! La dueña ahora me sigue en redes.'];
export const GIGI_FILM = ['¡Hola, mis huesitos! Hoy en la clínica...', 'Día en la vida de una vet influencer, ¿sí?', '¡Dale like si tu perro también se come los calcetines!'];

export const DIAG_THANKS: Record<'absurd' | 'technical' | 'evasive', string[]> = {
  absurd: ['¡Ahhh, ahora sí lo entiendo! Qué bien lo explica.', '¡Como un fideo! Clarísimo. Gracias, doctora.'],
  technical: ['Ajá... sí... claro... (no entendí nada).', '¿Me lo puede decir otra vez pero con dibujitos?'],
  evasive: ['Bueno... si usted lo dice. Tan tranquila que lo dice.', 'Mmm. Me quedo con la duda, pero confío.'],
};

export const WRONG_DIAG_HINT = 'Mmm... algo no cuadra con las pruebas. Valerio no lo va a dejar pasar.';

export const EMILIANA_COMPLAINT_REPLY = ['Cuénteme todo. Yo me encargo.', 'Tranquilo, está en las mejores botas de la ciudad.'];
export const EMILIANA_START = ['Turno de clínica. Botas atadas, fusta lista.', 'A ver qué nos trae el día. Y que Panchito se porte bien.'];

export const OR_READY = ['¡Paciente listo! Nos vemos en el quirófano.', 'Guantes, gorro, actitud. Al quirófano.'];

/** Carteles de la sala de espera (texto que se pinta en lienzo). */
export const POSTERS: Array<{ title: string; body: string; bg: string; fg: string }> = [
  { title: '¿TU PERRO COME CALCETINES?', body: 'No estás sola.\nPregunta en recepción.', bg: '#ff8fc7', fg: '#3b2146' },
  { title: 'VACUNA HOY', body: 'ladra mañana ♥', bg: '#9ff0d0', fg: '#3b2146' },
  { title: 'PROHIBIDO EL 5G', body: '(lo pidió Don Braulio)\nNo aplica al wifi.', bg: '#fff6fb', fg: '#c4136c' },
  { title: 'LOS GATOS NO SIEMPRE\nCAEN DE PIE', body: 'Firma: Duquesa', bg: '#c8a2e8', fg: '#3b2146' },
  { title: 'LÁVATE LAS MANOS', body: 'Sí, tú, Rodrigo.', bg: '#b8e1ff', fg: '#3b2146' },
  { title: 'TILA GRATIS', body: 'para dueños nerviosos\n(y para Fritz)', bg: '#fff1b8', fg: '#6d4a7a' },
  { title: 'HORARIO', body: 'De 9 a cuando\nValerio diga.', bg: '#ffd6e8', fg: '#3b2146' },
  { title: 'ZONA ESTÉRIL', body: 'Prohibido el paso a\nchihuahuas con cono.', bg: '#ffe066', fg: '#3b2146' },
];

export const pickLine = (rng: () => number, arr: readonly string[]): string => arr[Math.floor(rng() * arr.length) % arr.length];
