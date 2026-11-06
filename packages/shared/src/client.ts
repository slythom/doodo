import type { ClientMessage, ServerMessage } from './protocol';

export interface DoodoClientOptions {
  /** Token bearer (invité ou compte) envoyé en subprotocol. */
  token?: string;
  /** Callback des messages serveur (le store s'y abonne). */
  onMessage: (msg: ServerMessage) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * Client WS résilient : backoff exponentiel, resync via lastSeq (phase 2).
 * `WebSocket` existe à l'identique sur RN et web — même code partout.
 */
export class DoodoClient {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private lastSeq = 0;
  private closed = false;
  private queue: ClientMessage[] = [];

  constructor(
    private url: string,
    private opts: DoodoClientOptions,
  ) {}

  get status(): ConnectionStatus {
    if (this.closed) return 'closed';
    if (this.ws?.readyState === WebSocket.OPEN) return 'open';
    return this.attempts > 0 ? 'reconnecting' : 'connecting';
  }

  connect(): void {
    this.closed = false;
    this.openSocket();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // File d'attente : les messages partis avant l'ouverture (join_game,
      // quick_join…) seraient sinon jetés silencieusement.
      this.queue.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.opts.onStatusChange?.('closed');
  }

  private openSocket(): void {
    const protocols = this.opts.token ? [`bearer.${this.opts.token}`] : undefined;
    const ws = new WebSocket(this.url, protocols);
    this.ws = ws;
    this.opts.onStatusChange?.(this.status);

    ws.onopen = () => {
      this.attempts = 0;
      this.opts.onStatusChange?.('open');
      // Flush de la file à l'ouverture.
      for (const m of this.queue.splice(0)) {
        ws.send(JSON.stringify(m));
      }
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      if (msg.seq > this.lastSeq) this.lastSeq = msg.seq;
      this.opts.onMessage(msg);
    };

    ws.onclose = () => {
      if (this.closed) return;
      const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
      this.attempts += 1;
      this.opts.onStatusChange?.('reconnecting');
      setTimeout(() => this.openSocket(), delay);
    };

    ws.onerror = () => {
      // onclose suivra et déclenchera la reconnexion.
    };
  }
}
