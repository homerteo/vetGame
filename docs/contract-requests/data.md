# Peticiones de contrato — módulo `data`

No bloquean nada: los datos ya se ajustan a lo que hacen hoy los pasos. Se piden solo
**aclaraciones en los comentarios** de `src/core/contracts.ts` para que nadie las rompa después.

## 1. `RotateParams.degPerUnit`: signo del giro
- **Qué**: el comentario no dice en qué sentido gira el fragmento.
- **Hoy**: `RotateStep` usa `valor = startValue − giro / degPerUnit`, es decir,
  `giro = (startValue − valor) × degPerUnit`, aplicado con `rotate()` alrededor de `pivot`
  (positivo = horario en pantalla, y hacia abajo).
- **Datos**: Tanque (28 → 5, `degPerUnit` 1) gira **+23°**. `FragmentDef.target` de `tibialPlateau`
  es exactamente esa pose, así que la silueta fantasma y `alignmentError` coinciden con la rotación.
- **Propuesta**: comentar `degPerUnit` así: "giro del fragmento = (startValue − valor) × degPerUnit".

## 2. `BurrParams.forbidden`: margen
- **Hoy**: `BurrStep` marca `cordTouch` cuando el puntero queda a ≤ `brushMm` de `forbidden`.
- **Datos**: en Chorizo, el área de fresado queda a algo más de `brushMm` (2,5 mm) de la médula,
  así que se puede fresar entera sin falta; el hueso retirado llega a ~0,2 mm de ella.
- **Propuesta**: documentar "falta si el puntero está a ≤ brushMm de `forbidden`; `area` no debe
  acercarse a menos de `brushMm`".

## 3. `PickParams.items` puede estar vacío
- Merengue extrae solo la cabeza femoral (`removeFragmentIds: ['femoralHead']`) y no tiene
  elementos sueltos. Propuesta: comentar que `items` puede ser `[]` si hay `removeFragmentIds`.

## 4. `ScrewsParams`: longitud correcta
- Los datos suponen que la longitud ideal es la **menor opción ≥ profundidad** (lo mismo que
  `idealLength` en `Screws.ts`). Propuesta: decirlo en el comentario de `lengthOptionsMm`.
