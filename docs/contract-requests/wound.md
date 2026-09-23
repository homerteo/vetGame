# Peticiones de contrato — módulo wound (herida + escena 3D)

Ninguna es bloqueante: todo está resuelto localmente. Son aclaraciones para la integración.

## 1. Unidades de `SurgerySceneAPI.setLamp(level, aimOffset)`

- **Qué**: el contrato no dice en qué unidades va `aimOffset`.
- **Decisión local**: `aimOffset` está en **mm del espacio de herida**, relativo al centro de la herida
  (`x` → a lo largo de la mesa, hacia los pies; `y` → hacia la cirujana, igual que la `y` de la herida).
  `{x:0, y:0}` = foco centrado. Con desplazamientos grandes (> ~300 mm) el foco sube a la altura de una cara
  (selfie de Gigi). Ejemplo selfie: `scene.setLamp(0.15, { x: -420, y: -900 })` (Gigi está en `spots.gigi`).
- **Propuesta**: añadir el comentario `/** aimOffset en mm de herida respecto a su centro */` en `contracts.ts`.

## 2. Pulso del chorro arterial

- **Qué**: `WoundAPI` no recibe la FC, así que el chorro arterial late a un ritmo fijo (1,7 Hz ≈ 100 lpm)
  sincronizado con el tiempo de cirugía.
- **Propuesta (opcional)**: `WoundAPI.setHeartRate?(hr: number)` para que el chorro vaya con el monitor.

## 3. Extras no contractuales disponibles (no hace falta cambiar nada)

- `createInstrumentModel(id, opts?)`: `opts = { kittenScalpel?, bunnyDrill? }` para los cosméticos de la
  Boutique (`skin-bisturi-gatito`, `skin-taladro-conejo`). La firma del contrato sigue funcionando igual.
- `createSurgeryScene()` devuelve además `setInstrumentCosmetics(opts)`, `snapCamera(mode)` (cambio de
  cámara sin transición) y `woundDebug.stats()` (tiempos de la herida).
- `resize(w, h)` también llama a `renderer.setSize(w, h, false)` (idempotente si la integración ya lo hace).
