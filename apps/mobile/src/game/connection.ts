import { DoodoClient, applyServerMessage, createGameStore, initialState } from '@doodo/shared';
import type { GameStore } from '@doodo/shared';
import { WS_URL } from '@/config';
import { useSession } from '@/store/session';
import { playEvent } from '@/audio/manager';

let client: DoodoClient | null = null;

export const gameStore: GameStore = createGameStore();

/** Connecte le client WS à une salle et branche les messages sur le store. */
export function connectToRoom(code: string, spectate = false): void {
  disconnect();
  // Nouvelle table = état propre (sinon la phase/encan de l'ancienne partie traîne).
  gameStore.setState(initialState);
  const { clientId, username, accessToken } = useSession.getState();
  client = new DoodoClient(WS_URL, {
    onMessage: (msg) => {
      applyServerMessage((fn) => gameStore.setState(fn(gameStore.getState())), msg);
      void playEvent(msg.type);
    },
  });
  client.connect();
  client.send({
    type: 'join_game',
    payload: {
      code,
      name: username,
      clientId,
      spectate,
      ...(accessToken ? { token: accessToken } : {}),
    },
  });
}

export function disconnect(): void {
  client?.close();
  client = null;
}

export function isConnected(): boolean {
  return client?.status === 'open';
}

/** Connexion libre pour le matchmaking (quick_join). Le serveur nous
 *  rejoint ensuite dans une table — `joined` mettra à jour roomCode. */
export function connectQueue(name: string, clientId: string, token?: string): void {
  disconnect();
  gameStore.setState(initialState);
  client = new DoodoClient(WS_URL, {
    onMessage: (msg) =>
      applyServerMessage((fn) => gameStore.setState(fn(gameStore.getState())), msg),
  });
  client.connect();
  client.send({
    type: 'quick_join',
    payload: { name, clientId, ...(token ? { token } : {}) },
  });
}

export function send(msg: Parameters<DoodoClient['send']>[0]): void {
  client?.send(msg);
}
