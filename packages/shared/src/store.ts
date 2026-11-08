import { createStore } from 'zustand/vanilla';
import type {
  Bid,
  DieValue,
  GamePhase,
  PlayerInfo,
  Standing,
  ServerMessage,
  TableOptions,
} from './protocol';
import { DEFAULT_OPTIONS } from './protocol';

export interface ChatEntry {
  from: number;
  text?: string;
  emote?: string;
  at: number;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  /** Dés du joueur courant (filtrés serveur). */
  yourDice: DieValue[];
  /** seat → nombre de dés restants. */
  diceCounts: Record<number, number>;
  players: PlayerInfo[];
  options: TableOptions;
  roomCode: string | null;
  mySeat: number | null;
  currentBid: { seat: number; bid: Bid } | null;
  turnSeat: number | null;
  turnDeadline: number | null;
  /** Vue god : dés de tous (admin/mode dieu uniquement). */
  godDice: Record<number, DieValue[]> | null;
  /** Deadline de choix de dés en mode dieu (phase god_roll). */
  chooseDiceDeadline: number | null;
  /** État matchmaking (si en file de partie rapide). */
  matchmaking: { state: 'waiting' | 'matched'; position?: number; size?: number } | null;
  revealedDice: Record<number, DieValue[]> | null;
  /** Dernier appel à l'arbitre (dudo/calza) — qui l'a lancé. */
  call: { kind: 'dudo' | 'calza'; seat: number } | null;
  /** Résultat de la révélation : dés comptés, perdant, dés restants. */
  resolution: { matched: number; loser: number; remaining: number } | null;
  /** Sièges ayant cliqué « manche suivante » pendant la révélation. */
  revealReady: number[];
  standings: Standing[] | null;
  chat: ChatEntry[];
  /** Dernier projectile lancé (cle = timestamp pour re-render). */
  thrown: { item: string; fromSeat: number; seat: number; at: number } | null;
  lastError: { code: string; message: string } | null;
}

export const initialState: GameState = {
  phase: 'lobby',
  round: 0,
  yourDice: [],
  diceCounts: {},
  players: [],
  options: DEFAULT_OPTIONS,
  roomCode: null,
  mySeat: null,
  currentBid: null,
  turnSeat: null,
  turnDeadline: null,
  godDice: null,
  chooseDiceDeadline: null,
  matchmaking: null,
  revealedDice: null,
  call: null,
  resolution: null,
  revealReady: [],
  standings: null,
  chat: [],
  thrown: null,
  lastError: null,
};

export type GameStore = ReturnType<typeof createGameStore>;

export function createGameStore() {
  return createStore<GameState>(() => initialState);
}

/** Applique un message serveur au store. Point d'entrée unique — la scène
 * 3D comme l'UI 2D lisent le même état. */
export function applyServerMessage(
  set: (fn: (s: GameState) => Partial<GameState>) => void,
  msg: ServerMessage,
): void {
  switch (msg.type) {
    case 'joined':
      set(() => ({
        mySeat: msg.payload.seat,
        roomCode: msg.payload.code,
        matchmaking: null,
      }));
      break;
    case 'matchmaking':
      set(() => ({ matchmaking: msg.payload }));
      break;
    case 'choose_dice':
      set(() => ({
        phase: 'god_roll',
        chooseDiceDeadline: msg.payload.deadline,
      }));
      break;
    case 'lobby_state':
      set(() => ({
        players: msg.payload.players,
        options: msg.payload.options,
        roomCode: msg.payload.code,
      }));
      break;
    case 'game_started':
      set(() => ({ phase: 'round_roll', options: msg.payload.options }));
      break;
    case 'round_started':
      set(() => ({
        phase: 'bidding',
        round: msg.payload.round,
        yourDice: msg.payload.yourDice,
        diceCounts: msg.payload.diceCounts,
        currentBid: null,
        revealedDice: null,
        call: null,
        resolution: null,
        revealReady: [],
        chooseDiceDeadline: null,
      }));
      break;
    case 'turn':
      set(() => ({ turnSeat: msg.payload.seat, turnDeadline: msg.payload.deadline }));
      break;
    case 'bid_placed':
      set(() => ({ currentBid: { seat: msg.payload.seat, bid: msg.payload.bid } }));
      break;
    case 'dudo_called':
      set(() => ({ phase: 'resolving', call: { kind: 'dudo', seat: msg.payload.seat } }));
      break;
    case 'calza_called':
      set(() => ({ phase: 'resolving', call: { kind: 'calza', seat: msg.payload.seat } }));
      break;
    case 'reveal':
      set(() => ({
        revealedDice: msg.payload.allDice,
        resolution: {
          matched: msg.payload.matched,
          loser: msg.payload.loser,
          remaining: msg.payload.remaining,
        },
      }));
      break;
    case 'next_round_ready':
      set(() => ({ revealReady: msg.payload.seats }));
      break;
    case 'player_eliminated':
      set((s) => {
        const diceCounts = { ...s.diceCounts };
        diceCounts[msg.payload.seat] = 0;
        return { diceCounts };
      });
      break;
    case 'game_ended':
      set(() => ({ phase: 'ended', standings: msg.payload.standings }));
      break;
    case 'god_state':
      set(() => ({ godDice: msg.payload.allDice }));
      break;
    case 'chat':
      set((s) => ({
        chat: [...s.chat.slice(-99), { ...msg.payload, at: Date.now() }],
      }));
      break;
    case 'item_thrown':
      set(() => ({ thrown: { ...msg.payload, at: Date.now() } }));
      break;
    case 'error':
      set(() => ({ lastError: msg.payload }));
      break;
    default:
      break; // resync, pong, player_(dis|re)connected : phase 2
  }
}
