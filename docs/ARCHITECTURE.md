# Arquitectura — versión web

Stack: Vite 8 + TypeScript 7 (`tsc` nativo) + Three.js 0.186 + Canvas 2D + WebAudio. Pruebas: Vitest 5 (lógica) y Playwright (capturas headless). Sin otras dependencias: no instales paquetes.

Documentos de referencia:
- `docs/GDD.md` — diseño completo (reglas, números, personajes, casos, HUD, sonido).
- `src/core/contracts.ts` — **contratos congelados**: tipos e interfaces entre módulos. Mandan sobre el GDD.

## Reglas para todos los agentes

1. **Solo edita los archivos que te pertenecen** (tabla de abajo). Puedes crear archivos nuevos dentro de tus carpetas.
2. **No edites `src/core/*`** (contratos, EventBus, math, rng, constants, Input, Loop) ni `src/ui/theme.css` salvo que seas su dueño. Si necesitas un cambio de contrato, **no lo hagas**: escribe la petición en `docs/contract-requests/<tu-modulo>.md` (qué, por qué, propuesta) y resuélvelo localmente (tipos auxiliares propios).
3. **Dependencias entre módulos solo por interfaces** (inyección de dependencias). Importa solo de `src/core/*`, de tus propios archivos y de `three`. Nunca importes la implementación de otro módulo (se están escribiendo en paralelo). Para probar, crea dobles/fakes propios.
4. Identificadores en inglés; **todo texto visible en español** (latinoamericano neutro); comentarios en español.
5. **Sin assets externos**: geometría, texturas (Canvas) y sonido (WebAudio) procedurales. La única excepción ya presente son las fuentes de Google (Baloo 2, Nunito) en `index.html`.
6. Rendimiento: objetivo 60 fps en un M1 (GPU integrada). Evita asignaciones por fotograma en bucles calientes. La recomposición de la herida debe costar ≤ 4 ms.
7. Aleatoriedad que afecte al juego: `createRng(seed)` de `src/core/rng.ts` (determinista).
8. Contenido: respeta los límites del GDD §1 (sin desnudos ni sexo; "Buena niña" solo de la pareja y siempre afectuoso; ningún paciente muere; humanos adultos).
9. Verificación mínima antes de terminar:
   - `npx tsc --noEmit` sin errores **en tus archivos** (ignora errores ajenos, pero menciónalos en tu informe).
   - `npx vitest run <tu carpeta>` en verde si tienes lógica pura (y debes tenerla probada).
   - Si tu módulo es visual: página de desarrollo `dev/<nombre>.html` + `dev/<nombre>.ts` con fakes, levantada en **tu puerto** (`npx vite --port <puerto> --strictPort &`), captura con `node scripts/shot.mjs http://127.0.0.1:<puerto>/dev/<nombre>.html screenshots/<modulo>/<x>.png [esperaMs] [acciones.json]`, **mira la captura** (herramienta Read sobre el PNG) y corrige lo que se vea mal. Mata tu servidor al acabar: `pkill -f "vite --port <puerto>"`.
   - La máquina tiene 8 GB de RAM: como mucho un servidor vite y un navegador a la vez por agente; nunca los dejes corriendo.
10. Informe final (tu respuesta): archivos creados, exportaciones, decisiones, pruebas ejecutadas con resultado, capturas revisadas, peticiones de contrato y problemas conocidos.

## Módulos, dueños y exportaciones obligatorias

| Módulo (agente) | Archivos que posee | Exportaciones obligatorias (firma exacta) | Puerto dev |
| --- | --- | --- | --- |
| sim | `src/sim/**` | ver §sim | — |
| data | `src/data/**` | ver §data | — |
| wound | `src/surgery/WoundSurface.ts`, `src/surgery/SurgeryScene.ts`, `src/surgery/InstrumentModels.ts`, `src/surgery/scene/**`, `dev/wound.*`, `dev/scene.*` | ver §wound | 5311 |
| stepsA | `src/surgery/steps/{Incision,Hemostasis,Retract,Suture,Bandage,ClickTargets,Pick,CauteryTool,registryA}.ts`, `src/surgery/steps/testing/a/**`, tests `*.test.ts` de esos pasos, `dev/stepsA.*` | ver §steps | 5312 |
| stepsB | `src/surgery/steps/{Reduction,Rotate,Saw,Burr,DrillPins,Plate,Screws,registryB}.ts`, `src/surgery/minigames/ScrewCatch.ts`, `src/surgery/steps/testing/b/**`, tests, `dev/stepsB.*` | ver §steps | 5313 |
| crew | `src/characters/**`, `src/surgery/assistants/**`, `dev/characters.*`, `dev/crew.*` | ver §crew | 5314 |
| clinic | `src/clinic/**`, `dev/clinic.*` | ver §clinic | 5315 |
| ui | `src/ui/**` (incluido `theme.css`), `dev/hud.*`, `dev/screens.*` | ver §ui | 5316 |
| audio | `src/audio/**`, `dev/audio.*` | ver §audio | 5317 |
| integración (fase posterior) | `src/main.ts`, `src/game/**`, `src/surgery/SurgeryController.ts`, `src/surgery/steps/registry.ts`, `tests/e2e/**` | — | 5390 |

`src/surgery/steps/StepBase.ts` es una clase base opcional ya escrita (no la edites).

### §sim — lógica pura con pruebas (Vitest, entorno node)
```ts
// src/sim/Vitals.ts
export function createVitals(init: VitalsInit, opts?: { difficulty?: Difficulty }): VitalsAPI;
// src/sim/Bleeding.ts
export function createBleeding(opts?: { rateScale?: number }): BleedingAPI;   // rateScale: Residente 0.6, Especialista 1, Jefe 1.25
// src/sim/BloodPool.ts
export function createBloodPool(opts?: { cols?: number; rows?: number; capacityPctBV?: number; window?: Vec2[] }): BloodPoolAPI;
// src/sim/Bone.ts
export function createBone(anatomy: AnatomyDef): BoneAPI;
// src/sim/Emiliana.ts
export function createEmiliana(init: EmilianaInit): EmilianaAPI;
// src/sim/ChaosDirector.ts
export function createChaosDirector(cfg: ChaosConfig): ChaosDirectorAPI;
// src/sim/SurgeryLog.ts
export const FAULT_EXITO: Record<FaultKind, number>;          // penalización estándar (negativa)
export const FAULT_LABEL: Record<FaultKind, string>;          // texto en español
export function createSurgeryLog(onExito: (delta: number, reason: string) => void, bus?: EventBus<GameEvents>): SurgeryLogAPI;
// src/sim/Scoring.ts
export const RANK_MULTIPLIER: Record<Rank, number>;
export interface ChallengeStats { screwDrops: number; elapsedSec: number; targetSec: number; dominaCount: number; arrest: boolean; maxFieldPct: number; carmShotsUsed: number; carmShotsPlanned: number }
export function evaluateChallenge(kind: ValerioChallengeKind, s: ChallengeStats): boolean;
export function computeAudit(input: AuditInput): AuditResult;
export function provisionalRank(partial: { exitoAvg: number; exitoMin: number; techniqueAvg: number; faults: FaultKind[] }): Rank;
// src/sim/Progression.ts
export const SAVE_KEY = 'dra-emiliana-save-v1';
export function defaultSettings(): Settings;
export function defaultSave(): SaveData;
export function loadSave(storage?: Storage | null): SaveData;           // tolerante a datos corruptos
export function persistSave(save: SaveData, storage?: Storage | null): void;
export function applyAudit(save: SaveData, caseDef: CaseDef, result: AuditResult, extras: { viralClips: number }): SaveData;
export function reputationFrom(ranks: Rank[], viralClips: number): number;
export function isCaseUnlocked(save: SaveData, caseDef: CaseDef): boolean;
export function computeEffects(save: SaveData): BoutiqueEffects;      // por ids equipados (tabla del GDD §5)
export function buyItem(save: SaveData, item: BoutiqueItem): SaveData | null;
export function toggleEquip(save: SaveData, id: string): SaveData;
export function guideLevelFor(caseDef: CaseDef, difficulty: Difficulty): GuideLevel;
export function firmSweetUnlocked(save: SaveData): boolean;            // semana ≥ 4 desbloqueada
```
Afinado orientativo (ajústalo con pruebas y documenta):
- Sangrado (%BV/s): capilar 0,02 · venoso 0,06 · arterial 0,15 de media, pulsátil (forma de onda ligada a la FC). × rateScale.
- Charco: capacidad 5 %BV; inundación al 70%. Rejilla por defecto 64×40 celdas sobre 160×100 mm; el fluido se extiende (difusión) y se acumula en la ventana (`window`) si se da; fuera de la ventana se escurre más rápido.
- Aspiración de Rodrigo ≈ 0,12 %BV/s (la aplica el controlador vía `blood.suction`).
- Vitals: volumen perro 85 mL/kg, gato 60, conejo 60. FC base por especie/tamaño (perro toy ~120, grande ~90; gato ~160; conejo ~200). Pérdida > 15% → taquicardia; > 30% → PAM < 60 y caída rápida de Éxito. Éxito: +0,1/s si todo estable (tope 90); −0,5..−2/s con constantes fuera de rango. Hipotermia: −0,02 °C/s en pacientes pequeños con `hypothermiaRisk`, se revierte con `warming`.
- Emiliana: GDD §2 (costes, micro-crisis 3 s, mensaje +35/+25/10 s, caducidad por efectos, respiración +20, precisión −5/s, temblor creciente por debajo de 40 de Concentración, ×2 en micro, ×tremorScale, ×lowConcTremorMult).
- Director: intervalos base 20–35 s entre eventos (Especialista), valle 15–20 s tras eventos fuertes, simultaneidad por dificultad, ajuste adaptativo ±30%, nada en tutorial, `valerioGaze` periódico si está permitido. Duraciones: solo 4–6 s (hasta que se resuelva o 12 s máx.), selfie hasta resolver (máx. 15 s), temblor de Fritz 10 s, Panchito 8 s, llamada de Hortensia 6 s, aluminio de Braulio 10 s, mirada 6 s.
- Auditoría: GDD §5 exacto (pesos, topes, multiplicadores, +3 por reto).

### §data — datos del juego (Vitest valida integridad)
```ts
// src/data/cases.ts
export const CASES: CaseDef[];                 // 8 casos, index 0..7 (GDD §6)
export function getCase(id: string): CaseDef;  // lanza si no existe
// src/data/instruments.ts
export const INSTRUMENTS: Record<InstrumentId, InstrumentInfo>;
// src/data/boutique.ts
export const BOUTIQUE_ITEMS: BoutiqueItem[];   // ids EXACTOS de la tabla del GDD §5
// src/data/dialogue.ts
export const DIALOGUE: DialogueBank;
```
Convenciones geométricas (espacio de herida 160 × 100 mm, ver `src/core/constants.ts`):
- La incisión suele ser una polilínea más o menos horizontal por el centro (p. ej. de (30,50) a (130,50)); la sutura usa el mismo trazado.
- `anatomy.window` = ventana profunda alrededor de la incisión (≈ 26–34 mm de alto) donde se ve músculo/hueso al separar. Todo hueso, fragmento, sangrado, agujero y objetivo debe caer **dentro de la ventana** (salvo `closed`).
- El hueso es una forma alargada dentro de la ventana; los fragmentos llevan `polygon` local centrado en su origen y `start`/`target`. En fracturas, `start` desplazado y girado respecto a `target` (5–15 mm, 8–25°).
- Pesos de fases suman exactamente 100. Cada paso con parámetros coherentes: ids de fragmentos existentes, `depthsMm.length` = nº de agujeros, placa con `holes.length` = `options[correct].holes`, etc.
- Los pasos disponibles y su significado están documentados en los contratos (`StepParams`). Adapta las 6 fases genéricas a cada procedimiento (FHO sin placa: sierra + raspa; TPLO: sierra birradial + rotación + placa; hemilaminectomía: fresa con zona prohibida = médula + extracción de disco con pinzas; conejo: `closed` + reducción cerrada con rayos X + agujas + barras (clickTargets) + vendaje; carpo: fresa de cartílago + injerto (reducción `place`) + placa híbrida + tornillos).
- Diálogo: al menos 4 variantes por lista (8+ para las más frecuentes: órdenes, respuestas, caos, Valerio). Frases cortas (≤ 90 caracteres), cómicas, en español. `partnerMessages`: ≥ 10, cariñosas, con "Buena niña"/"Buena chica" en varias; algunas usan {nombre}.
- Tests: pesos 100, geometría dentro de límites y ventana, referencias válidas, textos no vacíos, ids de Boutique exactos, 8 casos con semanas 0..7, tutorial/final marcados.

### §wound — herida y escena del quirófano
```ts
// src/surgery/WoundSurface.ts
export function createWoundSurface(deps: { anatomy: AnatomyDef; incisionPath: Vec2[]; bone: BoneAPI; bleeding: BleedingAPI; blood: BloodPoolAPI; settings: Settings }): WoundAPI;
// src/surgery/SurgeryScene.ts
export function createSurgeryScene(deps: SurgerySceneDeps): SurgerySceneAPI;   // crea la herida internamente
// src/surgery/InstrumentModels.ts
export function createInstrumentModel(id: InstrumentId): THREE.Object3D;       // punta en el origen, apuntando a -Y
```
- La herida dibuja cada fotograma: capas de tejido con máscaras de corte (piel con pelaje rasurado alrededor → subcutáneo amarillo → fascia nacarada → músculo estriado → hueso marfil), retracción, ventana profunda, médula (si hay), hueso estático + fragmentos (resaltado, esquirlas `noTouch` con aviso), implantes de `bone.implants` (placa metálica con agujeros, tornillos con cabeza hexagonal, agujas, alambres, barras), sangrados (chorro arterial pulsátil, venoso oscuro, capilar), charco (`blood.grid`, brillo húmedo; por encima del 70% cubre de rojo opaco), calcomanías, guía (según nivel), siluetas fantasma, overlays de los pasos (ordenados por z), rayos X, oscuridad por luz, Modo Pastel y nivel de gore.
- La escena 3D: quirófano kawaii (azulejos lila/menta, lámpara cialítica con haz, monitor, bandeja de instrumental, camilla), paciente bajo paños lila con la cabeza visible y la ventana con el plano de la herida. `spots` para colocar personajes. Cámaras: `overview` (sala), `wound` (la herida ocupa ~55–65% central de la pantalla, en picado), `micro` (×3 sobre el centro de la ventana). `pick()` por raycast al plano de la herida.
- Página dev con fakes de BoneAPI/BleedingAPI/BloodPoolAPI (sangrados activos, charco a medio llenar, fragmentos, placa con tornillos) y `CharacterFactory` falso (cápsulas).

### §steps — pasos quirúrgicos (stepsA y stepsB)
```ts
// src/surgery/steps/registryA.ts
export const STEPS_A: Partial<Record<StepType, StepFactory>>;   // incision, hemostasis, retract, suture, bandage, clickTargets, pick
export function createCauteryTool(ctx: SurgeryContext): UniversalTool;   // exportada desde CauteryTool.ts y reexportada aquí
// src/surgery/steps/registryB.ts
export const STEPS_B: Partial<Record<StepType, StepFactory>>;   // reduction, rotate, saw, burr, drillPins, plate, screws
// src/surgery/minigames/ScrewCatch.ts
export function createScrewCatch(o: { layer: HTMLElement; beat: BeatClock; tremor: () => number; windowScale: number; audio: AudioAPI; onResult(r: 'perfect' | 'good' | 'miss'): void }): { update(dt: number): void; press(): void; dispose(): void };
```
- Cada paso implementa `StepController` (puedes extender `StepBase`). Recibe punteros ya procesados (temblor y Pulso Firme aplicados por el controlador).
- Efectos en el mundo: mutar `ctx.bone` (poses, `implants`), `ctx.wound.cut/erase/addDecal/addOverlay`, `ctx.bleeding.spawn/seal`; puntuar con `ctx.log.gesture/fault/bonus`; sonido con `ctx.audio.play/loop`; frases con `ctx.bus.emit('say', …)`; feedback con `ctx.hud.popText(texto, ctx.scene.project(mm), tipo)`; medidores con `gauges()`.
- Presión de la rueda (1..5) en `WoundPointer.pressure`. `Q/E` giran (onKey `KeyQ`/`KeyE`), `I` irriga, `1..3` elige longitud de tornillo, `Space` atrapa en ScrewCatch, `KeyR` arco en C.
- El cauterio universal (stepsA) sella cualquier sangrado activo a ≤ 4 mm: 1–2 s perfecto, 0,5–1 bien, > 3 s carbonización (falta `char`, calcomanía y humo), < 0,5 s no sella. Arterial sellado en < 5 s desde que apareció → `log.bonus('Hemorragia arterial controlada', 4)`.
- Pruebas unitarias con un contexto falso propio (`src/surgery/steps/testing/a|b/`): cada paso debe poder completarse simulando punteros, y los errores deben registrar la falta correcta.
- Tutorial (`caseDef.flags.tutorial`): pistas desde `ctx.dialogue.tutorialHints[tipo]` y tolerancias ×1,5.

### §crew — personajes 3D y equipo quirúrgico
```ts
// src/characters/factory.ts
export function createCharacterFactory(): CharacterFactory;
// src/surgery/assistants/Crew.ts
export function createCrew(deps: CrewDeps): CrewAPI;
```
- Personajes low-poly estilizados tipo "juguete de vinilo", reconocibles por silueta (GDD §2): Emiliana plus-size con corsé de vinilo fucsia brillante (clearcoat), anillas en D doradas, arnés shibari lavanda sobre el pecho con estetoscopio, gargantilla con candado de corazón, esposas de felpa rosa en el cinto, medias de rejilla (textura procedural), botas de plataforma, fusta rosada; Valerio alto con bata, canas, gafas; Rodrigo fornido con barriga, calva con rastas, camiseta de rock, auriculares; Fritz delgado y pálido con mascarilla en el mentón; Gigi con coleta alta rubia y móvil; Hortensia (señora elegante con abrigo de piel falsa y collar de perlas), Braulio (gorro de aluminio, chaleco), dueños genéricos. Animales: chihuahua (con cono opcional), caniche, bulldog, teckel, pit bull, border collie, gato, conejo. Todos animados proceduralmente (bob al andar, brazos, temblor, guitarra de aire, selfie, desmayo...).
- La tripulación coloca a Emiliana, Rodrigo, Fritz, Gigi y Valerio en `scene.spots`, reacciona a órdenes con los tiempos del GDD, a eventos de caos (solo de guitarra, selfie, temblor, Panchito entrando por la puerta, aluminio de Braulio, llamada de Hortensia, mirada de Valerio) y expone las APIs de Rodrigo/Fritz/Gigi/Valerio. Diálogo desde `deps.dialogue`, emitido con `bus.emit('say', …)`.

### §clinic — fase de clínica
```ts
// src/clinic/Clinic.ts
export function createClinic(deps: ClinicDeps): ClinicAPI;
```
- Escena 3D propia (tercera persona, cámara con seguimiento suave), WASD/flechas, `E` interactuar, `Espacio` placaje. Estaciones: sala de espera (cola de dueños con Paciencia/Histeria), camilla de exploración (mini-juegos de pruebas diagnósticas), negatoscopio (marcar lesión con clic), autoclave (asignar a Fritz), preparación (asignar a Rodrigo: rasurado/antisepsia), mostrador de consentimiento (asignar a Gigi), puertas de zonas estériles con Contaminación, transportín de Panchito. Diálogo de diagnóstico con 3 explicaciones. HUD propio de la clínica en `deps.uiRoot` (reloj del turno, cola, minimapa de contaminación, asignaciones, objetivo actual); límpialo en `dispose()`.
- Duración 4–6 min con botón/estación "Ir al quirófano" disponible cuando el diagnóstico está hecho (antes de tiempo = menos preparación). Tutorial guiado en el caso 0. Al terminar llama `deps.onComplete(outcome)` una sola vez.

### §ui — interfaz
```ts
// src/ui/SurgeryHud.ts
export function createSurgeryHud(root: HTMLElement, settings: Settings): SurgeryHudAPI;
// src/ui/Screens.ts
export function createScreens(root: HTMLElement, audio: AudioAPI | null): ScreensAPI;
// src/ui/CPROverlay.ts
export function createCPROverlay(root: HTMLElement): CPROverlayAPI;
// src/ui/BreathingOverlay.ts
export function createBreathingOverlay(root: HTMLElement): BreathingOverlayAPI;
```
- HUD según GDD §8 (la herida en el centro; interfaz en los márgenes). ECG dibujado en canvas con la FC real. Accesible: formas además de color, parpadeo lento, `reduceFlashes`, `colorblind`.
- Pantallas: título (con aviso de contenido y botón de ajustes), selección de caso (8 tarjetas con candado, estrellas, rango obtenido), briefing (paciente, dueño, diagnóstico, procedimiento, mecánica nueva, reto de Valerio, aviso), auditoría (animación de nota por componentes, rango grande, monedas, 3 peores momentos, comentario de Valerio, ficha educativa con aviso de rigor), Boutique (tarjetas con precio y equipar), ajustes (todos los campos de `Settings` + nombre y pronombres de la pareja), pausa, intersticial entre fases.
- RCP (GDD §5): compresiones con Espacio a 100–120/min (medidor de ritmo), ventilación automática de Fritz cada 6 s, ritmo en monitor, si FV: mantener D para cargar, "¡Despejen!" espera a `isClear()`, soltar D para descargar; resultado por calidad.
- Respiración cuadrada: 16 s, mantener Espacio al inspirar/retener según el cuadrado animado.

### §audio — sonido procedural
```ts
// src/audio/AudioEngine.ts
export function createAudio(): AudioAPI;
```
- Todo sintetizado con WebAudio (sin samples). Buses: master, música, efectos, ASMR (los bucles de instrumental), voz. Ducking bajo alarmas.
- `beat`: reloj de la música (110 BPM por defecto; RCP usa 110). `setMusic` con capas y transiciones suaves.
- Monitor: pitido con ritmo de la FC y tono ligado a la SpO₂; alarma si hay constantes fuera de rango; tono plano en paro.
- `voice`: `speechSynthesis` en español si `settings.tts` (elige voz es-MX/es-US/es-ES, tono/velocidad por personaje); si no, nada (los subtítulos los pinta la UI).
- Debe funcionar sin errores si `AudioContext` no existe (entorno de pruebas) — degradar a no-op.

## Flujo de un fotograma en el quirófano (lo implementa la integración)
1. Entrada → `scene.pick()` → mm; temblor (`emiliana.tremorMm()`) y Pulso Firme aplicados → `WoundPointer`.
2. Paso activo (o cauterio universal si el instrumento activo es `cautery`).
3. `bleeding.emit()` → `blood.add()`; `blood.suction()` en el foco de Rodrigo; `blood.step()`.
4. `vitals.update()`, `emiliana.update()`, `director.update()` → `crew.onChaosStart/End`.
5. `crew.update()`, `scene.update()` (llama a `wound.update()`), `hud.update(model)`, `audio.setVitals()`.
6. Éxito ≤ 0 → paro → `CPROverlay`.
   - El cruce de Éxito por 0 se anota donde se aplica la penalización (`SurgeryLog`, Mirada de Auditor, `setExito`): la regeneración de `vitals.update()` no puede "salvarlo" antes de la comprobación.

### Reglas de integración (entrada, pausa y errores)
- **Esc** lo decide solo `GameFlow` (`escapeAction` en `src/game/flowLogic.ts`): pausa en clínica y quirófano, reanuda si ya hay pausa. `SurgeryController` ignora Esc; si dos oyentes reaccionan, la pausa se abre y se cierra en la misma pulsación.
- Al pausar, `GameFlow` llama a `surgery.releaseInputs()` antes de `input.setEnabled(false)`. El controlador también suelta todo en paro, respiración, lectura de mensaje y `blur`. Una tecla que un paso aceptó al pulsarse siempre recibe su liberación, aunque la entrada esté bloqueada.
- El intersticial entre fases llama a `screens.hideAll()` en su `onDone`: si no, `.emi-screens` queda encima del lienzo y se come los clics.
- Ajustes cambiados en la pausa → `surgery.applySettings(s)` (la dificultad se conserva hasta el siguiente caso).
- El bucle va envuelto en `createFrameGuard`: un error en un fotograma se registra y el juego sigue; un paso que lanza se omite; 90 fotogramas seguidos con error → vuelta a la selección de caso.
