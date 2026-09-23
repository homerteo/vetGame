import type { BoutiqueItem } from '../core/contracts';

/**
 * Boutique de Emiliana (GDD §5): solo HuesoCoins ganadas, sin micropagos, ventajas ≤ 20%.
 * Los efectos los aplica `computeEffects` (src/sim/Progression) a partir de estos ids.
 */
export const BOUTIQUE_ITEMS: BoutiqueItem[] = [
  {
    id: 'gargantilla-estrella',
    name: 'Gargantilla con candado de estrella',
    priceHC: 150,
    description: 'Cuero lila, candado de estrella y una llavecita que tintinea cuando respiras hondo.',
    effectText: 'Los mensajes de tu pareja duran 30 s',
    category: 'accesorio',
    color: '#ffd6ec',
  },
  {
    id: 'botas-antideslizantes',
    name: 'Botas de plataforma antideslizantes',
    priceHC: 200,
    description: 'Ocho centímetros de suela con tacos de montaña. El charco del pasillo ya no te gana.',
    effectText: 'No resbalas en la clínica',
    category: 'accesorio',
    color: '#dccbff',
  },
  {
    id: 'anillas-oro-rosa',
    name: 'Anillas en D de oro rosa',
    priceHC: 250,
    description: 'Brillan como un atardecer y, por fin, te cabe un instrumento más en el cinto.',
    effectText: '+1 ranura de instrumental',
    category: 'accesorio',
    color: '#ffdccf',
  },
  {
    id: 'fusta-pompon',
    name: 'Fusta con borla de pompón',
    priceHC: 300,
    description: 'El chasquido suena igual de firme, pero el pompón te recuerda ser amable contigo misma.',
    effectText: 'La Orden de Dómina cuesta 12 de Reserva',
    category: 'accesorio',
    color: '#ffc4e3',
  },
  {
    id: 'esposas-arcoiris',
    name: 'Esposas de felpa arcoíris',
    priceHC: 350,
    description: 'Se enganchan a la cánula de Rodrigo y aspiran solitas. Nadie sabe cómo. Nadie pregunta.',
    effectText: '10 s de aspiración autónoma, una vez por cirugía (tecla H)',
    category: 'accesorio',
    color: '#cdf5e8',
  },
  {
    id: 'arnes-menta',
    name: 'Arnés shibari menta',
    priceHC: 400,
    description: 'Nudos de cuerda suave color menta que sostienen el estetoscopio... y la calma.',
    effectText: '−10% de temblor con Concentración baja',
    category: 'accesorio',
    color: '#bdf3de',
  },
  {
    id: 'skin-bisturi-gatito',
    name: 'Bisturí con mango de gatito',
    priceHC: 120,
    description: 'El mango tiene orejitas y bigotes. La hoja, cero orejitas. Corta igual de bien.',
    effectText: 'Cosmético',
    category: 'instrumental',
    color: '#ffe4f2',
  },
  {
    id: 'skin-taladro-conejo',
    name: 'Taladro con orejas de conejo',
    priceHC: 200,
    description: 'Las orejas vibran con las revoluciones. Fritz jura que lo miran fijo.',
    effectText: 'Cosmético',
    category: 'instrumental',
    color: '#e7ddff',
  },
  {
    id: 'gorros-corazones',
    name: 'Gorros quirúrgicos de corazones',
    priceHC: 180,
    description: 'Rodrigo lo usa sobre las rastas, Fritz se sonroja y Gigi ya lo subió a sus historias.',
    effectText: '+5 de moral del equipo',
    category: 'equipo',
    color: '#ffd3de',
  },
];
