# Peticiones de contrato — crew (personajes + tripulación)

Ninguna es bloqueante: todas están resueltas localmente. Se documentan para la integración.

## 1. `CrewDeps.beat?: BeatClock` (opcional)
- **Qué**: añadir el reloj de la música a `CrewDeps`.
- **Por qué**: el GDD dice que Rodrigo entra en groove "cuando el tempo de la música se alinea". Sin reloj, la tripulación lo aproxima con un groove espontáneo cada 22–34 s (si la moral ≥ 50), además del "¡Eso es rock!" tras Voz Firme o petición amable con moral alta.
- **Propuesta**: `beat?: BeatClock` en `CrewDeps`; si existe, el groove espontáneo se dispararía en los compases fuertes.

## 2. Nodos con nombre en los rigs (convención, no cambio de tipos)
- `CharacterRig` no expone huesos ni accesorios. La fábrica nombra nodos útiles y la tripulación los busca con `root.getObjectByName`: `head`, `handL`, `handR`, `eyeL`, `eyeR`, `glasses`, `lensL`, `lensR`, `phone`, `tray`, `cannula`, `crop`, `cone`.
- El brillo de la Mirada de Auditor se engancha a `lensL/lensR` (o `eyeL/eyeR`, o `head`) y funciona con rigs ajenos.
- **Propuesta** (futuro): documentar estos nombres en `contracts.ts` como constantes.

## 3. Frase de Emiliana al mandar
- `crew.command()` emite ya la frase de Emiliana (`dialogue.commands[target][tone]`, hablante `emiliana`) al instante, y la respuesta del asistente tras el retardo. La integración **no** debe emitir la frase de Emiliana otra vez. El chasquido de fusta (`sfx: whip`) y el coste de Reserva siguen siendo cosa del controlador/EmilianaAPI.

## 4. `visualStates()` reutiliza el array
- Para no asignar memoria por fotograma devuelve siempre el mismo array (objetos mutados). Si alguien necesita guardar un histórico, que copie.
