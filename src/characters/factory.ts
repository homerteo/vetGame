/**
 * Fábrica de personajes 3D procedurales estilo "juguete de vinilo".
 * Cada llamada crea un rig nuevo e independiente (recursos propios; libéralos con rig.dispose()).
 * Nodos con nombre útiles para otros módulos: 'head', 'handL', 'handR', 'eyeL', 'eyeR', 'glasses', 'lensL', 'lensR'.
 */
import type { AnimalModelId, CharacterFactory, CharacterRig, HumanId } from '../core/contracts';
import { buildAnimal } from './animals';
import type { HumanRig } from './HumanRig';
import { buildEmiliana } from './humans/emiliana';
import { mergeStatic, trimShadows } from './kit';
import { buildBraulio, buildHortensia, buildOwnerA, buildOwnerB, buildOwnerC } from './humans/owners';
import { buildFritz, buildGigi, buildRodrigo, buildValerio } from './humans/staff';

const HUMAN_BUILDERS: Record<HumanId, () => HumanRig> = {
  emiliana: buildEmiliana,
  valerio: buildValerio,
  rodrigo: buildRodrigo,
  fritz: buildFritz,
  gigi: buildGigi,
  hortensia: buildHortensia,
  braulio: buildBraulio,
  ownerA: buildOwnerA,
  ownerB: buildOwnerB,
  ownerC: buildOwnerC,
};

export function createCharacterFactory(): CharacterFactory {
  return {
    human(id: HumanId): CharacterRig {
      const build = HUMAN_BUILDERS[id];
      if (!build) throw new Error(`Personaje desconocido: ${id}`);
      const rig = build();
      rig.update(0);
      mergeStatic(rig.root, rig.kit);
      trimShadows(rig.root);
      return rig;
    },
    animal(id: AnimalModelId, opts?: { cone?: boolean; shaved?: boolean }): CharacterRig {
      const rig = buildAnimal(id, opts);
      rig.update(0);
      mergeStatic(rig.root, rig.kit);
      trimShadows(rig.root, 0.02);
      return rig;
    },
  };
}
