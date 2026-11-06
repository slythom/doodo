import { StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import type { DieValue, PlayerInfo } from '@doodo/shared';
import { Die } from './Dice';

/** Compte à rebours du tour (deadline unix ms ; 0 = pas de timer). */
export function TurnTimer({ deadline }: { deadline: number }) {
  const compute = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setLeft(compute()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  if (!deadline) return null;
  return (
    <Text style={[styles.timer, left <= 5 && styles.timerHot]}>{left}s</Text>
  );
}

/** Rangée des adversaires : pseudo, nb de dés, tour, connexion. */
export function PlayerRow({ players, diceCounts, turnSeat, godDice }: {
  players: PlayerInfo[];
  diceCounts: Record<number, number>;
  turnSeat: number | null;
  godDice: Record<number, DieValue[]> | null;
}) {
  return (
    <View style={styles.row}>
      {players.filter((p) => !p.isBot || true).map((p) => (
        <View key={p.seat} style={[styles.seat, turnSeat === p.seat && styles.seatTurn, !p.connected && styles.seatOff]}>
          <Text style={styles.name} numberOfLines={1}>
            {p.isBot ? '🤖 ' : ''}{p.name}
            {!p.connected && ' 📴'}
          </Text>
          <Text style={styles.count}>{diceCounts[p.seat] ?? 0} 🎲</Text>
          {godDice?.[p.seat] && (
            <View style={styles.godDice}>
              {godDice[p.seat].map((d, i) => <Die key={i} value={d} size={20} />)}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** Badge « Mode dieu » / « Palifico ». */
export function GameBadges({ godMode, palifico }: { godMode: boolean; palifico: boolean }) {
  return (
    <View style={styles.badges}>
      {godMode && <Text style={styles.badge}>⚡ MODE DIEU</Text>}
      {palifico && <Text style={[styles.badge, styles.badgePal]}>PALIFICO</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  timer: { color: '#a89880', fontSize: 16, fontWeight: '700' },
  timerHot: { color: '#e05038' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  seat: { backgroundColor: '#2a2018', borderRadius: 10, padding: 8, minWidth: 80, alignItems: 'center' },
  seatTurn: { borderColor: '#e8b74a', borderWidth: 2 },
  seatOff: { opacity: 0.5 },
  name: { color: '#f5e6c8', fontSize: 13, fontWeight: '600', maxWidth: 90 },
  count: { color: '#a89880', fontSize: 12 },
  godDice: { flexDirection: 'row', gap: 2, marginTop: 4 },
  badges: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  badge: { color: '#e8b74a', fontWeight: '800', fontSize: 12, backgroundColor: 'rgba(232,183,74,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  badgePal: { color: '#d07040' },
});
