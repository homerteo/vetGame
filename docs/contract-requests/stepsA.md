# Peticiones de contrato — stepsA

Todo funciona con los contratos actuales (soluciones locales descritas abajo). Estas son mejoras opcionales.

## 1. `UniversalTool.dispose?(): void`

- **Qué**: añadir un método opcional `dispose?(): void` a `UniversalTool`.
- **Por qué**: el cauterio pinta un overlay (chispa, anillo de contacto, humo) y un bucle de sonido. Sin `dispose` el controlador no puede limpiarlos al terminar la cirugía.
- **Solución local**: `createCauteryTool` devuelve `CauteryToolAPI` (subtipo de `UniversalTool`) con `dispose()`, `contactSeconds()` y `onBleeder()`. El overlay se quita solo cuando no hay contacto ni humo. Se recomienda que el controlador llame a `(tool as any).dispose?.()` al salir del quirófano.

## 2. Vendaje persistente (`DecalKind` 'bandage' o `wound.setBandage(center, radius, progress)`)

- **Qué**: una forma persistente de dibujar el vendaje terminado en la herida.
- **Por qué**: el vendaje se dibuja como overlay del paso, y `end()` debe quitar los overlays, así que el vendaje desaparece al cerrar el paso (es el último paso del caso, así que casi no se nota).
- **Propuesta**: `DecalKind` += `'bandage'`, con `opts.sizeMm` = radio. La herida lo pinta como un disco lila con corazones.
- **Solución local**: ninguna (se respeta la limpieza de `end()`).

## 3. Clic de rueda (botón 1) en `WoundPointer`

- **Qué**: solo es una nota para la integración, no hace falta cambiar tipos: los separadores aceptan `button === 1` (clic de rueda) como clic de trinquete. El controlador debe reenviar `pointerdown` y `pointerup` también con el botón 1.
