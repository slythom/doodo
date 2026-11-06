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
  revealedDice: Record<number, DieValue[]> | null;
  standings: Standing[] | null;
  chat: ChatEntry[];
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
  revealedDice: null,
  standings: null,
  chat: [],
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
      }));
      break;
    case 'turn':
      set(() => ({ turnSeat: msg.payload.seat, turnDeadline: msg.payload.deadline }));
      break;
    case 'bid_placed':
      set(() => ({ currentBid: { seat: msg.payload.seat, bid: msg.payload.bid } }));
      break;
    case 'dudo_called':
    case 'calza_called':
      set(() => ({ phase: 'resolving' }));
      break;
    case 'reveal':
      set(() => ({ revealedDice: msg.payload.allDice }));
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
    case 'error':
      set(() => ({ lastError: msg.payload }));
      break;
    default:
      break; // resync, pong, player_(dis|re)connected : phase 2
  }
}
