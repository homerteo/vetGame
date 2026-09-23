/**
 * Escena 3D del quirófano kawaii. Usa el renderer compartido (no crea otro).
 * Contiene la sala, el paciente bajo paños con la herida (lienzo 2D como textura), la lámpara
 * cialítica, el monitor, la bandeja, cámaras con transiciones suaves, picking y el instrumento
 * que sigue al puntero.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  CameraMode,
  CaseDef,
  InstrumentId,
  SurgerySceneAPI,
  SurgerySceneDeps,
  Vec2,
  StepParams,
  VitalsSnapshot,
} from '../core/contracts';
import { WOUND_H_MM, WOUND_W_MM } from '../core/constants';
import { clamp, polygonCentroid } from '../core/math';
import { createWoundSurface, type WoundSurfaceDebug } from './WoundSurface';
import {
  createInstrumentModel,
  disposeObject,
  instrumentTipMaterials,
  INSTRUMENT_POINTER_SCALE,
  INSTRUMENT_TILT_DEG,
  type InstrumentModelOptions,
} from './InstrumentModels';
import { buildRoom } from './scene/room';
import { buildPatient, WOUND_H_M, WOUND_SCALE, WOUND_W_M } from './scene/patient';
import { createMonitorScreen } from './scene/monitor';
import { damp, fitDistance, uvToMm } from './scene/woundMath';
import {
  cameraGoal,
  cameraTransitionSec,
  caseFocusRect,
  WOUND_FOV,
  easeCamera,
  incisionPathFor,
  instrumentBasis,
  mmToAnchor,
  stepFocusRect,
  type RectMm,
} from './scene/sceneMath';

type SpotName = 'emiliana' | 'rodrigo' | 'fritz' | 'gigi' | 'valerio' | 'tray' | 'lamp' | 'monitor' | 'door';

/** Extras de depuración y ajustes que no forman parte del contrato. */
export interface SurgerySceneExtras {
  /** Salta a un modo de cámara sin transición. */
  snapCamera(mode: CameraMode): void;
  readonly cameraMode: CameraMode;
  readonly woundDebug: WoundSurfaceDebug;
  /** Cosméticos de la Boutique para los modelos de instrumental. */
  setInstrumentCosmetics(o: InstrumentModelOptions): void;
  /**
   * Encuadre de 'micro' sobre la zona de trabajo del paso (fragmentos y objetivo, agujas, vendaje...).
   * null vuelve al encuadre del caso (hueso + todas las zonas de trabajo).
   */
  focusStep(params: StepParams | null): void;
}

export { incisionPathFor } from './scene/sceneMath';

const TILT_WOUND_DEG = 20;
/** Escala del instrumento en el puntero (algo menor que la de la herida para no taparla). */
const INSTRUMENT_SCALE = 1.2;
const FRAME_FRACTION = 0.6;

export function createSurgeryScene(deps: SurgerySceneDeps): SurgerySceneAPI & SurgerySceneExtras {
  const { renderer, caseDef, factory, bone, bleeding, blood, settings } = deps;
  const wound = createWoundSurface({
    anatomy: caseDef.anatomy,
    incisionPath: incisionPathFor(caseDef),
    bone,
    bleeding,
    blood,
    settings,
  });

  const scene = new THREE.Scene();
  scene.name = 'quirofano';
  scene.background = new THREE.Color('#e6d6f5');

  // ───────────── Renderer (solo ajustes, no se crea otro) ─────────────
  const applyRenderer = () => {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    if (renderer.shadowMap.type !== THREE.PCFShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap;
  };
  applyRenderer();

  // Entorno procedural para reflejos del metal y el vinilo.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room0 = new RoomEnvironment();
  const envRT = pmrem.fromScene(room0, 0.04);
  room0.dispose();
  const envTex = envRT.texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;

  // ───────────── Luces ─────────────
  const hemi = new THREE.HemisphereLight('#fff2fb', '#b79cf2', 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff4ea', 1.25);
  key.position.set(2.6, 4.2, 2.8);
  key.target.position.set(0, 0.8, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffa3d2', 0.7);
  rim.position.set(-2.5, 3, -3.2);
  scene.add(rim);

  // ───────────── Sala y paciente ─────────────
  const room = buildRoom();
  scene.add(room.group);
  const patient = buildPatient(factory, caseDef.patient.animal);
  scene.add(patient.group);

  // Plano de la herida con el lienzo como textura (aspecto húmedo).
  const woundTex = new THREE.CanvasTexture(wound.canvas);
  woundTex.colorSpace = THREE.SRGBColorSpace;
  woundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  woundTex.generateMipmaps = true;
  woundTex.minFilter = THREE.LinearMipmapLinearFilter;
  const woundMat = new THREE.MeshPhysicalMaterial({
    map: woundTex,
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.24,
    specularIntensity: 0.6,
  });
  const woundMesh = new THREE.Mesh(new THREE.PlaneGeometry(WOUND_W_M, WOUND_H_M), woundMat);
  woundMesh.name = 'herida';
  woundMesh.rotation.x = -Math.PI / 2;
  woundMesh.position.y = 0.0015;
  woundMesh.receiveShadow = true;
  patient.woundAnchor.add(woundMesh);

  // Monitor de constantes.
  const monitor = createMonitorScreen();
  const screenMat = new THREE.MeshBasicMaterial({ map: monitor.texture, toneMapped: false });
  room.monitorScreen.material = screenMat;

  // ───────────── Puntos de la sala ─────────────
  const mk = (name: SpotName, x: number, y: number, z: number, lookX: number, lookZ: number) => {
    const o = new THREE.Object3D();
    o.name = `spot:${name}`;
    o.position.set(x, y, z);
    o.lookAt(lookX, y, lookZ);
    scene.add(o);
    return o;
  };
  const valerioIn = !!caseDef.flags.valerioInRoom;
  const gal = new THREE.Vector3();
  room.galleryAnchor.getWorldPosition(gal);
  room.group.updateMatrixWorld(true);
  const lampWorld = new THREE.Vector3();
  room.lamp.head.getWorldPosition(lampWorld);
  const monWorld = new THREE.Vector3();
  room.monitorScreen.getWorldPosition(monWorld);
  const trayWorld = new THREE.Vector3();
  room.tray.getWorldPosition(trayWorld);
  const spots: Record<SpotName, THREE.Object3D> = {
    emiliana: mk('emiliana', 0.12, 0, 0.62, 0.12, 0),
    rodrigo: mk('rodrigo', 0.62, 0, 0.76, 0.2, 0),
    fritz: mk('fritz', 1.2, 0, -1.02, 0.6, -0.2),
    gigi: mk('gigi', -0.42, 0, -0.9, 0, 0),
    valerio: valerioIn ? mk('valerio', 1.3, 0, 1.0, 0.2, 0) : mk('valerio', gal.x, gal.y, gal.z, 0.2, 0),
    tray: mk('tray', trayWorld.x, 1.02, trayWorld.z, 0, 0),
    lamp: mk('lamp', lampWorld.x, lampWorld.y, lampWorld.z, 0, 0),
    monitor: mk('monitor', monWorld.x, monWorld.y, monWorld.z, 0.1, 0.6),
    door: mk('door', 3.05, 0, 1.1, 0, 1.1),
  };

  // ───────────── Cámara ─────────────
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const camera = new THREE.PerspectiveCamera(45, size.x / Math.max(1, size.y), 0.03, 40);
  let mode: CameraMode = 'overview';
  const woundCenter = new THREE.Vector3();
  const windowCenter = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const goalPos = new THREE.Vector3();
  const goalTarget = new THREE.Vector3();
  const curPos = new THREE.Vector3();
  const curTarget = new THREE.Vector3();
  const goal = { pos: goalPos, target: goalTarget, fov: 50 };
  let curFov = 50;
  // Transición de cámara con duración fija: al terminar, la cámara queda exactamente en su sitio
  // (un suavizado exponencial dejaba la herida deslizándose segundos después de la intro).
  const fromPos = new THREE.Vector3();
  const fromTarget = new THREE.Vector3();
  let fromFov = 50;
  let transT = 1;
  let transDur = 1;
  let shakeAmp = 0;
  let snapped = false;
  const winC = caseDef.anatomy.window.length >= 3 ? polygonCentroid(caseDef.anatomy.window) : { x: 80, y: 50 };

  function mmToWorld(mm: Vec2, out: THREE.Vector3, lift = 0.0015): THREE.Vector3 {
    mmToAnchor(mm, WOUND_W_M, WOUND_H_M, out, lift);
    return patient.woundAnchor.localToWorld(out);
  }

  // Zona de trabajo para 'micro': la del paso si se conoce; si no, la del caso entero.
  const caseFocus = caseFocusRect(caseDef);
  let stepFocus: RectMm | null = null;
  const focusCenter = new THREE.Vector3();
  const focus = { center: focusCenter, wM: 0, hM: 0 };
  let microInstScale = 1;

  function computeGoal(): void {
    patient.woundAnchor.updateMatrixWorld(true);
    mmToWorld({ x: WOUND_W_MM / 2, y: WOUND_H_MM / 2 }, woundCenter, 0);
    mmToWorld(winC, windowCenter, 0);
    const r = stepFocus ?? caseFocus;
    if (r) {
      mmToWorld({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, focusCenter, 0);
      focus.wM = ((r.x1 - r.x0) / WOUND_W_MM) * WOUND_W_M;
      focus.hM = ((r.y1 - r.y0) / WOUND_H_MM) * WOUND_H_M;
    }
    cameraGoal(mode, woundCenter, windowCenter, WOUND_W_M, WOUND_H_M, camera.aspect, TILT_WOUND_DEG, FRAME_FRACTION, goal, r ? focus : null);
    // En 'micro' el instrumento se reduce con el zoom real (entre ×1 y ×3) para ocupar lo mismo en pantalla.
    const dWound = fitDistance(WOUND_W_M, WOUND_H_M * Math.cos((TILT_WOUND_DEG * Math.PI) / 180), WOUND_FOV, camera.aspect, FRAME_FRACTION);
    microInstScale = mode === 'micro' ? clamp(goalPos.distanceTo(goalTarget) / Math.max(1e-6, dWound), 0.33, 1) : 1;
  }

  // ───────────── Instrumento en el puntero ─────────────
  const instHolder = new THREE.Group();
  instHolder.name = 'instrumento';
  instHolder.visible = false;
  scene.add(instHolder);
  const instCache = new Map<InstrumentId, { obj: THREE.Object3D; tips: THREE.MeshStandardMaterial[] }>();
  let cosmetics: InstrumentModelOptions = {};
  let instId: InstrumentId | null = null;
  let instMm: Vec2 = { x: 80, y: 50 };
  let instActive = false;
  let instAngle = 0;
  let instHeat = 0;
  const UP = new THREE.Vector3(0, 1, 0);
  const LEAN = { x: 1, y: 0, z: -0.25 };
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  const az = new THREE.Vector3();
  const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [ax, ay, az];
  const basis = new THREE.Matrix4();
  const heatColor = new THREE.Color();
  const COLD = new THREE.Color('#000000');
  const HOT = new THREE.Color('#ff5a14');

  function instrumentEntry(id: InstrumentId) {
    let e = instCache.get(id);
    if (!e) {
      const obj = createInstrumentModel(id, cosmetics);
      obj.scale.setScalar(INSTRUMENT_SCALE * (INSTRUMENT_POINTER_SCALE[id] ?? 1));
      e = { obj, tips: instrumentTipMaterials(obj) };
      instCache.set(id, e);
    }
    return e;
  }

  function placeInstrument(t: number): void {
    if (!instId) return;
    const e = instrumentEntry(instId);
    // Inclinación hacia la derecha (y algo hacia el fondo para no tapar); giro con angleDeg alrededor de la normal.
    instrumentBasis(INSTRUMENT_TILT_DEG[instId], instAngle, LEAN, axes);
    basis.makeBasis(ax, ay, az);
    instHolder.quaternion.setFromRotationMatrix(basis);
    mmToWorld(instMm, instHolder.position, 0.0022);
    // En modo micro el instrumento se reduce con el zoom para no ocupar media pantalla.
    instHolder.scale.setScalar(microInstScale);
    if (instActive) {
      instHolder.position.y -= 0.0012;
      instHolder.position.x += Math.sin(t * 93) * 0.00045;
      instHolder.position.z += Math.sin(t * 71 + 1) * 0.00045;
    }
    heatColor.copy(COLD).lerp(HOT, clamp(instHeat, 0, 1));
    for (const m of e.tips) {
      m.emissive.copy(heatColor);
      m.emissiveIntensity = 1 + instHeat * 3;
    }
  }

  // ───────────── Lámpara ─────────────
  let lampLevel = 1;
  let lampGoal = 1;
  const aimGoal = new THREE.Vector3();
  const aimCur = new THREE.Vector3();
  let aimInit = false;
  const LAMP_INTENSITY = 1.5;

  // ───────────── Respiración y animaciones ─────────────
  let breathRate = 14;
  let breathPhase = 0;
  let ivT = 0;
  let clockT = 0;
  let overviewWeight = 1;

  // Picking.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hits: THREE.Intersection[] = [];

  const api: SurgerySceneAPI & SurgerySceneExtras = {
    scene,
    camera,
    wound,
    spots,

    setCameraMode(m) {
      if (m !== mode && snapped) {
        fromPos.copy(curPos);
        fromTarget.copy(curTarget);
        fromFov = curFov;
        transT = 0;
        transDur = cameraTransitionSec(mode, m);
      }
      mode = m;
      computeGoal();
    },

    snapCamera(m) {
      mode = m;
      computeGoal();
      curPos.copy(goalPos);
      curTarget.copy(goalTarget);
      curFov = goal.fov;
      snapped = true;
      transT = transDur;
      overviewWeight = m === 'overview' ? 1 : 0;
    },

    get cameraMode() {
      return mode;
    },
    get woundDebug() {
      return wound;
    },

    focusStep(params) {
      const next = params ? stepFocusRect(params, caseDef.anatomy) : null;
      const same = next === stepFocus || (!!next && !!stepFocus && next.x0 === stepFocus.x0 && next.y0 === stepFocus.y0 && next.x1 === stepFocus.x1 && next.y1 === stepFocus.y1);
      if (same) return;
      if (mode === 'micro' && snapped) {
        // Paneo suave hasta el nuevo encuadre.
        fromPos.copy(curPos);
        fromTarget.copy(curTarget);
        fromFov = curFov;
        transT = 0;
        transDur = 0.6;
      }
      stepFocus = next;
      computeGoal();
    },

    setInstrumentCosmetics(o) {
      cosmetics = { ...o };
      for (const [, e] of instCache) {
        e.obj.removeFromParent();
        disposeObject(e.obj);
      }
      instCache.clear();
      if (instId) {
        const id = instId;
        instId = null;
        api.showInstrument(id);
      }
    },

    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      hits.length = 0;
      raycaster.intersectObject(woundMesh, false, hits);
      const hit = hits[0];
      if (hit?.uv) return { mm: uvToMm(hit.uv.x, hit.uv.y, WOUND_W_MM, WOUND_H_MM), onWound: true };
      // Fuera del plano visible: se prolonga el plano de la herida.
      woundMesh.getWorldPosition(tmpV);
      plane.setFromNormalAndCoplanarPoint(UP, tmpV);
      const p = raycaster.ray.intersectPlane(plane, tmpV2);
      if (!p) return { mm: { x: -1, y: -1 }, onWound: false };
      patient.woundAnchor.worldToLocal(p);
      return {
        mm: { x: (p.x / WOUND_W_M + 0.5) * WOUND_W_MM, y: (p.z / WOUND_H_M + 0.5) * WOUND_H_MM },
        onWound: false,
      };
    },

    project(mm) {
      const rect = renderer.domElement.getBoundingClientRect();
      mmToWorld(mm, tmpV, 0.0015).project(camera);
      return { x: rect.left + ((tmpV.x + 1) / 2) * rect.width, y: rect.top + ((1 - tmpV.y) / 2) * rect.height };
    },

    setLamp(level, aimOffset) {
      lampGoal = clamp(level, 0, 1);
      const k = 0.001 * WOUND_SCALE;
      const ox = clamp(aimOffset.x * k, -2.5, 2.5);
      const oz = clamp(aimOffset.y * k, -2.5, 2.5);
      aimGoal.copy(woundCenter).add(tmpV.set(ox, 0, oz));
      // Si el foco se va lejos (selfie), apunta a la altura de una cara.
      const far = Math.hypot(ox, oz);
      aimGoal.y += clamp((far - 0.3) * 0.9, 0, 0.75);
      wound.setLight(lampGoal);
    },

    showInstrument(id) {
      if (id === instId) {
        instHolder.visible = !!id && id !== 'plate';
        return;
      }
      instHolder.clear();
      instId = id;
      if (!id) {
        instHolder.visible = false;
        return;
      }
      const e = instrumentEntry(id);
      e.obj.position.set(0, 0, 0);
      e.obj.rotation.set(0, 0, 0);
      instHolder.add(e.obj);
      // La placa la dibuja el paso (vista previa girada y contorneada): un segundo modelo 3D sin girar confundía.
      instHolder.visible = id !== 'plate';
    },

    poseInstrument(mm, opts = {}) {
      instMm = { x: mm.x, y: mm.y };
      instActive = !!opts.active;
      instAngle = opts.angleDeg ?? 0;
      instHeat = opts.heat ?? 0;
    },

    setPatientBreathing(rate) {
      breathRate = clamp(rate, 0, 60);
    },

    setMonitorVitals(v: VitalsSnapshot) {
      monitor.setVitals(v);
    },

    shake(intensity) {
      shakeAmp = Math.max(shakeAmp, clamp(intensity, 0, 1));
    },

    update(dt, t) {
      wound.update(dt, t);
      woundTex.needsUpdate = true;

      // Respiración: paños, herida y fuelle de anestesia.
      breathPhase += dt * (breathRate / 60) * Math.PI * 2;
      const br = breathRate > 0 ? Math.sin(breathPhase) : 0;
      patient.setBreath(br);
      room.bellows.scale.y = 0.24 * (0.78 - 0.18 * br);

      // Cámara con transición suave y temblor.
      computeGoal();
      if (!snapped) {
        curPos.copy(goalPos);
        curTarget.copy(goalTarget);
        curFov = goal.fov;
        snapped = true;
      }
      transT = Math.min(transDur, transT + dt);
      const k = easeCamera(transT / transDur);
      curPos.lerpVectors(fromPos, goalPos, k);
      curTarget.lerpVectors(fromTarget, goalTarget, k);
      curFov = fromFov + (goal.fov - fromFov) * k;
      camera.position.copy(curPos);
      if (shakeAmp > 0.001) {
        const dist = curPos.distanceTo(curTarget);
        const a = shakeAmp * 0.018 * dist;
        camera.position.x += Math.sin(t * 47) * a;
        camera.position.y += Math.sin(t * 53 + 1.3) * a;
        camera.position.z += Math.sin(t * 41 + 2.1) * a;
        shakeAmp = Math.max(0, shakeAmp - dt * 2.5);
      }
      camera.lookAt(curTarget);
      overviewWeight = damp(overviewWeight, mode === 'overview' ? 1 : 0, 5, dt);
      // En vista de herida no se dibuja nada a más de ~12 cm sobre ella (brazos, lámpara):
      // el plano cercano de la cámara recorta lo que se interpondría.
      const woundDist = curPos.distanceTo(curTarget);
      const clipNear = Math.max(0.03, woundDist - (mode === 'micro' ? 0.07 : 0.12));
      const near = clipNear + (0.03 - clipNear) * overviewWeight;
      if (Math.abs(camera.fov - curFov) > 0.01 || Math.abs(camera.near - near) > 0.001) {
        camera.fov = curFov;
        camera.near = near;
        camera.updateProjectionMatrix();
      }

      // Lámpara: intensidad y orientación suaves.
      if (!aimInit) {
        aimCur.copy(aimGoal);
        aimInit = true;
      }
      lampLevel = damp(lampLevel, lampGoal, 6, dt);
      aimCur.set(damp(aimCur.x, aimGoal.x, 3, dt), damp(aimCur.y, aimGoal.y, 3, dt), damp(aimCur.z, aimGoal.z, 3, dt));
      room.lamp.head.lookAt(aimCur);
      room.lamp.light.target.position.copy(aimCur);
      room.lamp.light.intensity = LAMP_INTENSITY * lampLevel;
      room.lamp.leds.emissiveIntensity = 0.6 + 2.6 * lampLevel;
      room.lamp.head.getWorldPosition(tmpV);
      const beamLen = tmpV.distanceTo(aimCur);
      room.lamp.beam.scale.set(1, 1, Math.max(0.2, beamLen - 0.05));
      room.lamp.beamMat.opacity = 0.14 * lampLevel * overviewWeight;
      room.lamp.beam.visible = room.lamp.beamMat.opacity > 0.003;

      // Instrumento.
      placeInstrument(t);

      // Monitor, gotero, luz de la puerta y reloj.
      monitor.update(dt);
      ivT = (ivT + dt) % 1.3;
      room.ivDrop.position.y = 1.66 - Math.min(1, ivT / 0.5) * 0.045;
      room.ivDrop.visible = ivT < 0.55;
      room.doorLight.emissiveIntensity = 1.4 + Math.sin(t * 2.6);
      clockT -= dt;
      if (clockT <= 0) {
        clockT = 10;
        const mins = 10 * 60 + 5 + t / 60;
        room.clock.draw(Math.floor(mins / 60), mins % 60);
      }
    },

    render() {
      applyRenderer();
      renderer.render(scene, camera);
    },

    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      computeGoal();
    },

    dispose() {
      for (const [, e] of instCache) {
        e.obj.removeFromParent();
        disposeObject(e.obj);
      }
      instCache.clear();
      patient.dispose();
      scene.traverse((o) => {
        const light = o as THREE.Light;
        if ((light as THREE.SpotLight).isSpotLight || (light as THREE.DirectionalLight).isDirectionalLight) light.dispose();
      });
      disposeObject(scene);
      monitor.dispose();
      woundTex.dispose();
      // El render target entero (textura + framebuffer), no solo su textura.
      envRT.dispose();
      pmrem.dispose();
      scene.clear();
    },
  };

  computeGoal();
  api.setLamp(1, { x: 0, y: 0 });
  return api;
}
