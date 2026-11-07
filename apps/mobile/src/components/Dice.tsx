import { StyleSheet, Text, View } from 'react-native';
import type { DieValue } from '@doodo/shared';

// Grille 3×3 : indices des cellules contenant un point (0=haut-gauche … 8=bas-droite).
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({ value, size = 40, dim = false, inverted = false, highlight = false }: {
  value: DieValue; size?: number; dim?: boolean; inverted?: boolean; highlight?: boolean;
}) {
  if (value === 1) {
    // Paco = tête de perroquet (spec fonc.)
    return (
      <View style={[styles.die, styles.paco, highlight && styles.highlighted,
        { width: size, height: size, borderRadius: size / 6, opacity: dim ? 0.4 : 1 }]}>
        <Text style={{ fontSize: size * 0.62, lineHeight: size * 0.9 }}>🦜</Text>
      </View>
    );
  }
  const pip = size * 0.22;
  const cells = new Set(PIPS[value]);
  return (
    <View style={[styles.die, inverted && styles.dieInverted, highlight && styles.highlighted,
      { width: size, height: size, borderRadius: size / 6, opacity: dim ? 0.4 : 1 }]}>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => (
          <View key={i} style={styles.cell}>
            {cells.has(i) && (
              <View style={[styles.pip, inverted && styles.pipInverted,
                { width: pip, height: pip, borderRadius: pip / 2 }]} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

export function DiceRow({ dice, size = 40, dim = false, inverted = false,
  highlightValue, highlightWild = false }: {
  dice: DieValue[]; size?: number; dim?: boolean; inverted?: boolean;
  /** Valeur à surligner (enchère en cours). */
  highlightValue?: DieValue;
  /** Les Pacos comptent aussi (joker actif). */
  highlightWild?: boolean;
}) {
  const hl = (d: DieValue) =>
    highlightValue !== undefined &&
    (d === highlightValue || (highlightWild && d === 1 && highlightValue !== 1));
  return (
    <View style={styles.row}>
      {dice.map((d, i) => (
        <Die key={i} value={d} size={size} dim={dim} inverted={inverted} highlight={hl(d)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  die: {
    backgroundColor: '#f5f0e6',
  },
  dieInverted: { backgroundColor: '#2a2018' },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: '6%',
  },
  cell: {
    width: '33.33%',
    height: '33.33%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pip: {
    backgroundColor: '#2a2018',
  },
  pipInverted: { backgroundColor: '#f5f0e6' },
  paco: { backgroundColor: '#e8b74a', alignItems: 'center', justifyContent: 'center' },
  highlighted: { backgroundColor: '#e8b74a', borderWidth: 2, borderColor: '#2a2018' },
  row: { flexDirection: 'row', gap: 8 },
});
