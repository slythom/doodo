import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { disconnect, gameStore, send, connectQueue } from '@/game/connection';
import { useSession } from '@/store/session';

export default function Queue() {
  const s = useStore(gameStore);
  const { clientId, username, accessToken } = useSession();

  useEffect(() => {
    connectQueue(username, clientId, accessToken ?? undefined);
    return () => { disconnect(); };
  }, [clientId, username, accessToken]);

  // matched → l'acteur nous a rejoints : `joined` porte le code.
  useEffect(() => {
    if (s.roomCode) router.replace(`/room/${s.roomCode}`);
  }, [s.roomCode]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Partie rapide</Text>
      <Text style={styles.sub}>
        {s.matchmaking?.state === 'matched'
          ? 'Table trouvée !'
          : `En file… ${s.matchmaking?.size ?? 0} joueur(s)`}
      </Text>
      <Text style={styles.hint}>Des bots complètent au bout de 60 s</Text>
      <Pressable style={styles.btn} onPress={() => { send({ type: 'quick_leave' }); disconnect(); router.back(); }}>
        <Text style={styles.btnText}>Annuler</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1410', alignItems: 'center', justifyContent: 'center', gap: 14 },
  title: { color: '#f5e6c8', fontSize: 28, fontWeight: '800' },
  sub: { color: '#e8b74a', fontSize: 17 },
  hint: { color: '#a89880', fontSize: 13 },
  btn: { backgroundColor: '#a03c2e', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 20 },
  btnText: { color: '#fff', fontWeight: '700' },
});
