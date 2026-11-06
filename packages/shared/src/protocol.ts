/**
 * Protocole WebSocket Doodo — miroir TS des types Go (spec tech §5).
 * Source de vérité côté client ; garder synchronisé avec server/internal/ws.
 */

export interface Bid {
  qty: number;
  /** 1 = Paco */
  value: number;
}

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export type TurnTimer = 15 | 30 | 60 | 0;

export interface TableOptions {
  diceCount: 3 | 4 | 5;
  pacoWild: boolean;
  calzaEnabled: boolean;
  palifico: boolean;
  turnTimer: TurnTimer;
  maxPlayers: number;
  godMode: boolean;
  customRules: string[];
}

export const DEFAULT_OPTIONS: TableOptions = {
  diceCount: 5,
  pacoWild: true,
  calzaEnabled: true,
  palifico: true,
  turnTimer: 30,
  maxPlayers: 6,
  godMode: false,
  customRules: [],
};

export type GodAction =
  | { action: 'set_dice'; dice: DieValue[] }
  | { action: 'force_resolve' }
  | { action: 'kick'; seat: number }
  | { action: 'end_game' };

// ─── Client → Serveur ────────────────────────────────────────────────

export type ClientMessage =
  | {
      type: 'join_game';
      payload: {
        code: string;
        name: string;
        clientId: string;
        spectate?: boolean;
        adminKey?: string;
        /** Access JWT (invité ou compte) — résout userID/admin côté serveur. */
        token?: string;
      };
    }
  | {
      type: 'quick_join';
      payload: { name: string; clientId: string; token?: string };
    }
  | { type: 'quick_leave' }
  | { type: 'start_game' }
  | { type: 'leave_game' }
  | { type: 'set_ready'; payload: { ready: boolean } }
  | { type: 'update_options'; payload: { options: TableOptions } }
  | { type: 'add_bot' | 'remove_bot' | 'kick'; payload: { seat: number } }
  | { type: 'bid'; payload: Bid }
  | { type: 'dudo' }
  | { type: 'calza' }
  | { type: 'god_action'; payload: GodAction }
  | { type: 'chat'; payload: { text?: string; emote?: string } }
  | { type: 'ping' };

// ─── Serveur → Client ────────────────────────────────────────────────

export type GamePhase =
  | 'lobby'
  | 'round_roll'
  | 'god_roll' // choix des dés en mode dieu
  | 'bidding'
  | 'resolving'
  | 'ended';

export interface PlayerInfo {
  seat: number;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
}

export interface Standing {
  seat: number;
  name: string;
  finalRank: number;
}

interface Msg<T, P> {
  type: T;
  seq: number;
  payload: P;
}

export interface ResyncSnapshot {
  phase: GamePhase | 'god_roll';
  options: TableOptions;
  players: PlayerInfo[];
  diceCounts: Record<number, number>;
  yourDice: DieValue[];
  currentBid: { seat: number; bid: Bid } | null;
  turnSeat: number;
  turnDeadline: number;
  godDice?: Record<number, DieValue[]>;
  standings?: Standing[];
}

export type ServerMessage =
  | Msg<'joined', { code: string; seat: number; spectator: boolean }>
  | Msg<'matchmaking', { state: 'waiting' | 'matched'; position?: number; size?: number }>
  | Msg<'choose_dice', { deadline: number }>
  | Msg<'lobby_state', { players: PlayerInfo[]; options: TableOptions; code: string | null }>
  | Msg<'game_started', { options: TableOptions }>
  | Msg<'round_started', { round: number; yourDice: DieValue[]; diceCounts: Record<number, number> }>
  | Msg<'turn', { seat: number; deadline: number }>
  | Msg<'bid_placed', { seat: number; bid: Bid }>
  | Msg<'dudo_called', { seat: number }>
  | Msg<'calza_called', { seat: number }>
  | Msg<'reveal', { allDice: Record<number, DieValue[]>; matched: number; loser: number; remaining: number }>
  | Msg<'player_eliminated', { seat: number; finalRank: number }>
  | Msg<'game_ended', { standings: Standing[] }>
  | Msg<'player_disconnected' | 'player_reconnected', { seat: number; graceDeadline?: number }>
  | Msg<'god_state', { allDice: Record<number, DieValue[]> }>
  | Msg<'god_powers', { actions: GodAction['action'][] }>
  | Msg<'chat', { from: number; text?: string; emote?: string }>
  | Msg<'resync', ResyncSnapshot>
  | Msg<'error', { code: string; message: string }>
  | Msg<'pong', Record<string, never>>;
