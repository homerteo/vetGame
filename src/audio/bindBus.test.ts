import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus';
import type { AudioAPI, GameEvents, SfxName, SpeakerId } from '../core/contracts';
import { bindAudioToBus } from './bindBus';

describe('bindAudioToBus', () => {
  it('reenvía sfx y say, ignora a la pareja y se desconecta', () => {
    const played: SfxName[] = [];
    const said: SpeakerId[] = [];
    const audio = {
      play: (n: SfxName) => played.push(n),
      voice: (s: SpeakerId) => said.push(s),
    } as unknown as AudioAPI;
    const bus = new EventBus<GameEvents>();
    const off = bindAudioToBus(audio, bus);
    bus.emit('sfx', { name: 'whip' });
    bus.emit('say', { speaker: 'valerio', text: 'Doctora.' });
    bus.emit('say', { speaker: 'pareja', text: 'Buena niña ♥' });
    off();
    bus.emit('sfx', { name: 'crunch' });
    expect(played).toEqual(['whip']);
    expect(said).toEqual(['valerio']);
  });
});
