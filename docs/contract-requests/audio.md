# Peticiones de contrato — audio

Todo funciona con los contratos actuales. Estas son mejoras opcionales con solución local ya implementada.

## 1. Cortar un efecto en curso: `AudioAPI.stopSfx?(name: SfxName): void`

- **Qué**: método opcional para detener con fundido corto un efecto que aún suena.
- **Por qué**: `defibCharge` dura 2 s (sube hasta el pitido de "listo"). Si el jugador suelta **D** antes (GDD §5, RCP), el silbido sigue sonando y el ducking de la música se mantiene. Lo mismo con `autoclave` o `phone` si se cancela la acción.
- **Solución local**: `createAudioEngine()` (en `src/audio/AudioEngine.ts`) devuelve `AudioEngine`, subtipo de `AudioAPI` con `stopSfx(name)`. `createAudio()` devuelve el mismo objeto tipado como `AudioAPI`, así que la integración puede hacer `(audio as AudioEngine).stopSfx?.('defibCharge')` o crear el audio con `createAudioEngine()`.

## 2. Nota para la integración (sin cambio de tipos)

- `bindAudioToBus(audio, bus)` en `src/audio/bindBus.ts` conecta los eventos `sfx` (→ `play`) y `say` (→ `voice`, excepto `pareja`, que es solo texto) del bus global.
- `audio.beat` usa el tiempo **audible** del AudioContext (`getOutputTimestamp`) cuando está en marcha y `performance.now()` si no; es continuo al pasar de uno a otro. En silencio corre a 110 BPM. Los cambios de tempo de `setMusic` entran en el siguiente pulso libre (sin saltos de fase).
- Llamar `audio.unlock()` en el primer `pointerdown`/`keydown`. Antes de eso todo es no-op salvo el reloj de pulso; `setMusic`/`setVitals`/`applySettings` se recuerdan y se aplican al desbloquear. Un `loop()` pedido antes del desbloqueo se crea en su primer `set()` posterior.
