import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom, timeout } from 'rxjs';
import {
  PRODUCTS,
  isTerminal,
  type OrderInput,
  type Operation,
  type Stock,
  type Order,
  type Status,
} from '../../../packages/contracts/src/index';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnDestroy {
  readonly products = PRODUCTS;
  readonly http = inject(HttpClient);
  readonly fb = inject(FormBuilder);
  readonly form = this.fb.nonNullable.group({
    keyboard: [
      2,
      [Validators.required, Validators.min(0), Validators.max(10), Validators.pattern(/^\d+$/)],
    ],
    mouse: [
      1,
      [Validators.required, Validators.min(0), Validators.max(10), Validators.pattern(/^\d+$/)],
    ],
    headphones: [
      0,
      [Validators.required, Validators.min(0), Validators.max(10), Validators.pattern(/^\d+$/)],
    ],
  });
  readonly session = signal<{ sessionId: string; expiresAt: string } | null>(null);
  readonly stock = signal<Stock[]>([]);
  readonly orders = signal<Order[]>([]);
  readonly operations = signal<
    { operationId: string; clientOrderId: string; status: Status; updatedAt: string }[]
  >([]);
  readonly operation = signal<Operation | null>(null);
  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly note = signal('');
  readonly lastConfirmed = signal<OrderInput | null>(null);
  readonly pending = signal<{ key: string; body: OrderInput } | null>(null);
  readonly busy = computed(
    () =>
      this.loading() ||
      this.sending() ||
      (!!this.operation() && !isTerminal(this.operation()!.status)),
  );
  readonly labels: Record<Status, string> = {
    ACCEPTED: 'Recibido',
    PROCESSING: 'Procesando',
    RETRY_WAIT: 'Reintentando',
    SUCCEEDED: 'Pedido confirmado',
    REJECTED: 'Pedido rechazado',
    DUPLICATE: 'Duplicado detectado',
    FAILED_TECHNICAL: 'Fallo de integración',
  };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private epoch = 0;
  constructor() {
    void this.init();
  }
  private async call<T>(
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) {
    return firstValueFrom(
      this.http.request<T>(method, url, { body, headers }).pipe(timeout(10_000)),
    );
  }
  private message(e: unknown) {
    return e instanceof HttpErrorResponse
      ? (e.error?.error?.message ?? 'No se pudo conectar con la demo. Puedes volver a intentarlo.')
      : 'No se pudo conectar con la demo. Puedes volver a intentarlo.';
  }
  async init() {
    this.loading.set(true);
    this.error.set('');
    try {
      const s = await this.call<{ sessionId: string; expiresAt: string }>(
        'POST',
        '/api/demo-sessions',
      );
      this.session.set(s);
      const confirmed = sessionStorage.getItem(`confirmed:${s.sessionId}`);
      if (confirmed) this.lastConfirmed.set(JSON.parse(confirmed));
      const uncertain = sessionStorage.getItem(`pending:${s.sessionId}`);
      if (uncertain) this.pending.set(JSON.parse(uncertain));
      await this.refresh();
      const active = sessionStorage.getItem('active-operation');
      if (active) void this.poll(active, Date.now(), ++this.epoch);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.loading.set(false);
    }
  }
  async refresh() {
    const [stock, orders, operations] = await Promise.all([
      this.call<{ items: Stock[] }>('GET', '/api/stock'),
      this.call<{ items: Order[] }>('GET', '/api/orders'),
      this.call<{ items: ReturnType<AppComponent['operations']> }>('GET', '/api/operations'),
    ]);
    this.stock.set(stock.items);
    this.orders.set(orders.items);
    this.operations.set(operations.items);
  }
  quantity(sku: string) {
    return this.stock().find((s) => s.sku === sku)?.available ?? '—';
  }
  formOrder(): OrderInput {
    const v = this.form.getRawValue();
    return {
      clientOrderId: `WEB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      items: [
        { sku: 'DEMO-001', quantity: v.keyboard },
        { sku: 'DEMO-002', quantity: v.mouse },
        { sku: 'DEMO-003', quantity: v.headphones },
      ].filter((i) => i.quantity > 0),
    };
  }
  async scenario(kind: 'valid' | 'stock' | 'duplicate') {
    if (kind === 'duplicate') {
      const body = this.lastConfirmed();
      if (body) await this.submit(structuredClone(body));
      return;
    }
    this.form.setValue(
      kind === 'valid'
        ? { keyboard: 2, mouse: 1, headphones: 0 }
        : { keyboard: 0, mouse: 0, headphones: 3 },
    );
    await this.submit(this.formOrder());
  }
  async submit(input?: OrderInput) {
    if (this.busy()) return;
    this.error.set('');
    this.note.set('');
    if (this.form.invalid && !input) {
      this.error.set('Usa cantidades enteras entre 0 y 10.');
      return;
    }
    const body = input ?? this.formOrder();
    if (!body.items.length) {
      this.error.set('Selecciona al menos un producto.');
      return;
    }
    await this.dispatch({ key: crypto.randomUUID(), body });
  }
  async resend() {
    const p = this.pending();
    if (p && !this.busy()) await this.dispatch(p);
  }
  private async dispatch(p: { key: string; body: OrderInput }) {
    this.sending.set(true);
    this.pending.set(p);
    this.error.set('');
    sessionStorage.setItem(`pending:${this.session()!.sessionId}`, JSON.stringify(p));
    try {
      const accepted = await this.call<{ operationId: string; status: Status }>(
        'POST',
        '/api/orders',
        p.body,
        { 'Idempotency-Key': p.key },
      );
      sessionStorage.setItem('active-operation', accepted.operationId);
      sessionStorage.setItem(`payload:${accepted.operationId}`, JSON.stringify(p.body));
      this.pending.set(null);
      sessionStorage.removeItem(`pending:${this.session()!.sessionId}`);
      await this.poll(accepted.operationId, Date.now(), ++this.epoch);
    } catch (e) {
      this.error.set(
        this.message(e) + ' Conservamos la solicitud para reenviarla con la misma clave.',
      );
    } finally {
      this.sending.set(false);
    }
  }
  async select(id: string) {
    this.error.set('');
    await this.poll(id, Date.now(), ++this.epoch);
  }
  private async poll(id: string, started: number, epoch: number): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.destroyed || epoch !== this.epoch) return;
    try {
      const op = await this.call<Operation>('GET', `/api/operations/${id}`);
      if (epoch !== this.epoch) return;
      this.operation.set(op);
      if (isTerminal(op.status)) {
        if (op.status === 'SUCCEEDED') {
          const payload = sessionStorage.getItem(`payload:${id}`);
          if (payload) {
            this.lastConfirmed.set(JSON.parse(payload));
            sessionStorage.setItem(`confirmed:${this.session()!.sessionId}`, payload);
          }
        }
        if (sessionStorage.getItem('active-operation') === id)
          sessionStorage.removeItem('active-operation');
        await this.refresh();
        return;
      }
      if (Date.now() - started > 120_000)
        this.note.set(
          'Seguimos comprobando el resultado. La espera no significa que el pedido haya fallado.',
        );
      this.timer = setTimeout(
        () => void this.poll(id, started, epoch),
        (Date.now() - started < 10_000 ? 1000 : 3000) + Math.random() * 200,
      );
    } catch (e) {
      this.error.set(this.message(e));
      const wait = e instanceof HttpErrorResponse && e.status === 429 ? 60_000 : 5000;
      this.timer = setTimeout(() => void this.poll(id, started, epoch), wait);
    }
  }
  async reset() {
    if (this.busy()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const s = await this.call<{ sessionId: string; expiresAt: string }>(
        'POST',
        '/api/demo-sessions/reset',
      );
      this.session.set(s);
      this.operation.set(null);
      this.lastConfirmed.set(null);
      this.pending.set(null);
      sessionStorage.removeItem('active-operation');
      this.epoch++;
      if (this.timer) clearTimeout(this.timer);
      await this.refresh();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.loading.set(false);
    }
  }
  resultMessage(op: Operation) {
    switch (op.result?.code) {
      case 'ORDER_CREATED':
        return 'El ERP confirmó el pedido y actualizó el stock.';
      case 'INSUFFICIENT_STOCK':
        return 'No hay existencias suficientes. Ningún producto fue descontado.';
      case 'ORDER_ALREADY_PROCESSED':
        return 'El pedido ya estaba resuelto. No se descontó stock otra vez.';
      case 'ORDER_ID_CONFLICT':
        return 'El identificador ya pertenece a un pedido con otro contenido.';
      case 'INTEGRATION_UNAVAILABLE':
        return 'La integración no pudo completarse. No se registró un pedido nuevo.';
      default:
        return 'El pedido sigue su recorrido por la integración.';
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
  }
}
