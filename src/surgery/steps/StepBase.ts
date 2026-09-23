import type {
  ChecklistItem,
  Gauge,
  InstrumentId,
  StepController,
  StepDef,
  StepParams,
  SurgeryContext,
  WoundPointer,
} from '../../core/contracts';

/**
 * Base opcional para pasos quirúrgicos. Implementa lo común de StepController.
 * Las subclases definen `instruments`, sobrescriben los manejadores y llaman a `complete()`.
 */
export abstract class StepBase<P extends StepParams> implements StepController {
  protected ctx!: SurgeryContext;
  protected done = false;
  protected overlayIds: string[] = [];

  abstract readonly instruments: InstrumentId[];

  constructor(public readonly def: StepDef) {}

  get params(): P {
    return this.def.params as P;
  }

  begin(ctx: SurgeryContext): void {
    this.ctx = ctx;
    this.onBegin();
  }

  /** Gancho para inicializar tras recibir el contexto. */
  protected onBegin(): void {}

  update(_dt: number): void {}
  onPointerDown(_p: WoundPointer): void {}
  onPointerMove(_p: WoundPointer): void {}
  onPointerUp(_p: WoundPointer): void {}
  onKey(_key: string, _down: boolean): boolean {
    return false;
  }

  checklist(): ChecklistItem[] {
    return [{ label: this.def.label, done: this.done }];
  }

  abstract progress(): number;

  isComplete(): boolean {
    return this.done;
  }

  abstract hint(): string;

  gauges(): Gauge[] {
    return [];
  }

  /** Marca el paso como terminado (idempotente). */
  protected complete(): void {
    if (this.done) return;
    this.done = true;
    this.ctx.bus.emit('step:complete', { stepId: this.def.id, type: this.def.params.type });
  }

  /** Registra un overlay para quitarlo automáticamente en end(). */
  protected overlay(o: Parameters<SurgeryContext['wound']['addOverlay']>[0]): void {
    this.ctx.wound.addOverlay(o);
    this.overlayIds.push(o.id);
  }

  end(): void {
    for (const id of this.overlayIds) this.ctx.wound.removeOverlay(id);
    this.overlayIds = [];
    this.onEnd();
  }

  protected onEnd(): void {}
}
