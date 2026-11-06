import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { Die } from './Dice';
import type { DieValue, GodAction, PlayerInfo } from '@doodo/shared';

interface Props {
  players: PlayerInfo[];
  isAdmin: boolean;
  godMode: boolean;
  myDice: DieValue[];
  onAction: (a: GodAction) => void;
}

/** Panneau god : admin = tous pouvoirs ; mode dieu = choix de ses dés. */
export function GodPanel({ players, isAdmin, godMode, myDice, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [seat, setSeat] = useState(0);
  const [dice, setDice] = useState<DieValue[]>([6, 6, 6, 6, 6]);
  if (!isAdmin && !godMode) return null;

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.toggle} onPress={() => setOpen(!open)}>
        <Text style={styles.toggleText}>⚡</Text>
      </Pressable>
      {open && (
        <View style={styles.panel}>
          <Text style={styles.title}>{isAdmin ? 'God mode (admin)' : 'Mode dieu'}</Text>

          <Text style={styles.label}>Fixer un tirage :</Text>
          {isAdmin && (
            <View style={styles.seats}>
              {players.filter((p) => p.seat < 100).map((p) => (
                <Pressable key={p.seat} onPress={() => setSeat(p.seat)}
                  style={[styles.seatBtn, seat === p.seat && styles.sel]}>
                  <Text style={styles.seatText}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.diceRow}>
            {dice.map((d, i) => (
              <Pressable key={i} onPress={() => {
                const nd = [...dice];
                nd[i] = ((d % 6) + 1) as DieValue;
                setDice(nd);
              }}>
                <Die value={d} size={30} />
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.btn} onPress={() =>
            onAction({ action: 'set_dice', seat: isAdmin ? seat : undefined, dice })}>
            <Text style={styles.btnText}>Appliquer le tirage</Text>
          </Pressable>

          {isAdmin && (
            <View style={styles.adminRow}>
              <Pressable style={styles.btn} onPress={() => onAction({ action: 'force_resolve' })}>
                <Text style={styles.btnText}>Résoudre</Text>
              </Pressable>
              <Pressable style={styles.btn} onPress={() => onAction({ action: 'kick', seat })}>
                <Text style={styles.btnText}>Kick</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.danger]} onPress={() => onAction({ action: 'end_game' })}>
                <Text style={styles.btnText}>Fin</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** Écran de choix de dés en mode dieu (phase god_roll). */
export function ChooseDice({ count, onDone }: { count: number; onDone: (dice: DieValue[]) => void }) {
  const [dice, setDice] = useState<DieValue[]>(() =>
    Array.from({ length: count }, () => 6 as DieValue));
  return (
    <View style={styles.choose}>
      <Text style={styles.chooseTitle}>Choisis tes {count} dés</Text>
      <View style={styles.diceRow}>
        {dice.map((d, i) => (
          <Pressable key={i} onPress={() => {
            const nd = [...dice];
            nd[i] = ((d % 6) + 1) as DieValue;
            setDice(nd);
          }}>
            <Die value={d} size={44} />
          </Pressable>
        ))}
      </View>
      <Pressable style={[styles.btn, styles.big]} onPress={() => onDone(dice)}>
        <Text style={styles.btnText}>Valider</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 8, left: 8 },
  toggle: { backgroundColor: 'rgba(232,183,74,0.9)', padding: 10, borderRadius: 10 },
  toggleText: { fontSize: 18 },
  panel: { marginTop: 6, width: 260, backgroundColor: 'rgba(20,14,8,0.95)', borderRadius: 10, padding: 10, gap: 8 },
  title: { color: '#e8b74a', fontWeight: '800', fontSize: 14 },
  label: { color: '#a89880', fontSize: 12 },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  seatBtn: { backgroundColor: '#2a2018', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  sel: { backgroundColor: '#4a3826', borderColor: '#e8b74a', borderWidth: 1 },
  seatText: { color: '#f5e6c8', fontSize: 12 },
  diceRow: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  btn: { backgroundColor: '#8a5a2b', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center' },
  big: { paddingVertical: 14, paddingHorizontal: 28 },
  danger: { backgroundColor: '#a03c2e' },
  btnText: { color: '#fff', fontWeight: '700' },
  adminRow: { flexDirection: 'row', gap: 6 },
  choose: { alignItems: 'center', gap: 16, padding: 20 },
  chooseTitle: { color: '#f5e6c8', fontSize: 20, fontWeight: '700' },
});
