/**
 * Conecta el audio al bus global: `sfx` → play, `say` → voz (la pareja es solo texto;
 * Panchito ladra). Devuelve una función para desconectar.
 */
import type { EventBus } from '../core/EventBus';
import type { AudioAPI, GameEvents } from '../core/contracts';

export function bindAudioToBus(audio: AudioAPI, bus: EventBus<GameEvents>): () => void {
  const offs = [
    bus.on('sfx', (e) => audio.play(e.name, { volume: e.volume, pitch: e.pitch })),
    bus.on('say', (e) => {
      if (e.speaker !== 'pareja') audio.voice(e.speaker, e.text);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
