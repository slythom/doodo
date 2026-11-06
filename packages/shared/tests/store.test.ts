import { describe, expect, it } from 'vitest';
import { applyServerMessage, createGameStore } from '../src/store';
import type { ServerMessage } from '../src/protocol';

describe('applyServerMessage', () => {
  it('passe en bidding après round_started avec les dés filtrés', () => {
    const store = createGameStore();
    const msg: ServerMessage = {
      type: 'round_started',
      seq: 1,
      payload: {
        round: 1,
        yourDice: [3, 5, 1, 6, 2],
        diceCounts: { 0: 5, 1: 5, 2: 5 },
      },
    };
    applyServerMessage((fn) => store.setState(fn(store.getState())), msg);
    const s = store.getState();
    expect(s.phase).toBe('bidding');
    expect(s.yourDice).toHaveLength(5);
    expect(s.diceCounts[0]).toBe(5);
  });

  it('enregistre l’enchère courante puis la révélation', () => {
    const store = createGameStore();
    const apply = (m: ServerMessage) =>
      applyServerMessage((fn) => store.setState(fn(store.getState())), m);

    apply({ type: 'bid_placed', seq: 2, payload: { seat: 1, bid: { qty: 4, value: 3 } } });
    expect(store.getState().currentBid?.bid.qty).toBe(4);

    apply({ type: 'dudo_called', seq: 3, payload: { seat: 0 } });
    expect(store.getState().phase).toBe('resolving');

    apply({
      type: 'reveal',
      seq: 4,
      payload: { allDice: { 0: [1, 2], 1: [3, 3] }, matched: 2, loser: 1, remaining: 4 },
    });
    expect(store.getState().revealedDice?.[1]).toEqual([3, 3]);
  });

  it('le flux god expose tous les dés au destinataire god', () => {
    const store = createGameStore();
    applyServerMessage(
      (fn) => store.setState(fn(store.getState())),
      { type: 'god_state', seq: 5, payload: { allDice: { 0: [1], 1: [6] } } },
    );
    expect(store.getState().godDice?.[0]).toEqual([1]);
  });
});
