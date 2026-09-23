# Peticiones de contrato — ui

Ninguna bloquea: todo está resuelto localmente. Son mejoras opcionales para la integración.

1. **`SurgeryHudAPI.applySettings?(s: Settings): void`** (opcional).
   - Por qué: `createSurgeryHud(root, settings)` solo recibe los ajustes al crearse. Si el jugador cambia
     subtítulos, daltonismo, Modo Pastel o "Reducir destellos" desde la pausa, el HUD no se entera.
   - Solución local: la integración puede hacer `hud.dispose()` y volver a crear el HUD al salir de Ajustes
     (es barato: el HUD se reconstruye en < 2 ms y `update()` repinta todo en el siguiente fotograma).

2. **`EmilianaSnapshot.message.totalSec`** (opcional).
   - Por qué: el anillo de cuenta atrás del reloj necesita la duración total (20 s o 30 s con la gargantilla).
   - Solución local: el HUD toma como total el `secondsLeft` del primer fotograma en que `pending` pasa a `true`.

3. **`ScreensAPI.showBoutique`: `onBuy(id)` podría devolver el `SaveData` actualizado** en lugar de `boolean`.
   - Solución local: si `onBuy` devuelve `true`, la pantalla descuenta el precio y marca el artículo como
     comprado; `onToggleEquip` alterna el equipado localmente. Volver a llamar a `showBoutique` con el
     guardado nuevo también funciona.
