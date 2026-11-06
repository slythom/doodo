import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { Die } from './Dice';
import type { Bid, DieValue } from '@doodo/shared';

interface Props {
  current: Bid | null;
  onBid: (b: Bid) => void;
  onDudo: () => void;
  onCalza: () => void;
  calzaEnabled: boolean;
  disabled: boolean;
}

export function BidSelector({ current, onBid, onDudo, onCalza, calzaEnabled, disabled }: Props) {
  const [qty, setQty] = useState((current?.qty ?? 0) + 1);
  const [value, setValue] = useState<DieValue>((current?.value as DieValue) ?? 6);

  const minQty = current ? current.qty + 1 : 1;
  const effQty = Math.max(qty, minQty);

  return (
    <View style={styles.container} pointerEvents={disabled ? 'none' : 'auto'}>
      <View style={styles.qtyRow}>
        <Pressable style={styles.step} onPress={() => setQty(Math.max(minQty, effQty - 1))}>
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.qty}>{effQty}×</Text>
        <Pressable style={styles.step} onPress={() => setQty(effQty + 1)}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
      <View style={styles.values}>
        {([1, 2, 3, 4, 5, 6] as DieValue[]).map((v) => (
          <Pressable key={v} onPress={() => setValue(v)} style={value === v && styles.selected}>
            <Die value={v} size={36} />
          </Pressable>
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.bid]} disabled={disabled} onPress={() => onBid({ qty: effQty, value })}>
          <Text style={styles.btnText}>Enchérir</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.dudo]} disabled={disabled || !current} onPress={onDudo}>
          <Text style={styles.btnText}>Dudo !</Text>
        </Pressable>
        {calzaEnabled && (
          <Pressable style={[styles.btn, styles.calza]} disabled={disabled || !current} onPress={onCalza}>
            <Text style={styles.btnText}>Calza !</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  step: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#4a3826', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f5e6c8', fontSize: 28, fontWeight: '700' },
  qty: { color: '#f5e6c8', fontSize: 32, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  values: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  selected: { borderWidth: 2, borderColor: '#e8b74a', borderRadius: 8 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  btn: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12 },
  bid: { backgroundColor: '#c8955c' },
  dudo: { backgroundColor: '#a03c2e' },
  calza: { backgroundColor: '#3d6b4f' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
