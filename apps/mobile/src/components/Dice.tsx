import { StyleSheet, Text, View } from 'react-native';
import type { DieValue } from '@doodo/shared';

const FACES: Record<number, string> = {
  1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅',
};

export function Die({ value, size = 40, dim = false }: { value: DieValue; size?: number; dim?: boolean }) {
  return (
    <View style={[styles.die, { width: size, height: size, borderRadius: size / 6, opacity: dim ? 0.4 : 1 }]}>
      <Text style={[styles.face, { fontSize: size * 0.75, lineHeight: size }]}>{FACES[value]}</Text>
    </View>
  );
}

export function DiceRow({ dice, size = 40, dim = false }: { dice: DieValue[]; size?: number; dim?: boolean }) {
  return (
    <View style={styles.row}>
      {dice.map((d, i) => (
        <Die key={i} value={d} size={size} dim={dim} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  die: {
    backgroundColor: '#f5f0e6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  face: { color: '#2a2018', fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8 },
});
