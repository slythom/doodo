import { Link, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type RoomInfo } from '@/api/http';
import { useSession } from '@/store/session';
import { connectToRoom } from '@/game/connection';
import { t } from '@doodo/shared';

export default function Lobby() {
  const { username } = useSession();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setRooms(await api.listGames());
    } catch {
      // backend injoignable
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0); // évite setState synchrone dans l'effect
    const id = setInterval(refresh, 5000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [refresh]);

  const join = (c: string, spectate = false) => {
    connectToRoom(c.trim().toUpperCase(), spectate);
    router.push(`/room/${c.trim().toUpperCase()}`);
  };

  const create = async (isPublic: boolean) => {
    setBusy(true);
    try {
      const res = await api.createGame({} as never, isPublic);
      join(res.code);
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const quickJoin = () => router.push('/queue');

  return (
    <View style={styles.container}>
      <Link href="/settings" style={styles.gear}>⚙</Link>
      <Text style={styles.title}>{t('lobby.title')}</Text>
      <Text style={styles.who}>{username}</Text>

      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => void create(false)} disabled={busy}>
          <Text style={styles.btnText}>Table privée</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void create(true)} disabled={busy}>
          <Text style={styles.btnText}>Table publique</Text>
        </Pressable>
      </View>
      <Pressable style={[styles.btn, styles.quick]} onPress={quickJoin}>
        <Text style={styles.btnText}>⚡ {t('home.quickGame')}</Text>
      </Pressable>

      <View style={styles.codeRow}>
        <TextInput style={styles.codeInput} value={code} onChangeText={setCode}
          placeholder="CODE" placeholderTextColor="#8a7a60" autoCapitalize="characters" maxLength={6} />
        <Pressable style={styles.btn} onPress={() => join(code)} disabled={code.length !== 6}>
          <Text style={styles.btnText}>Rejoindre</Text>
        </Pressable>
      </View>

      <FlatList
        data={rooms}
        keyExtractor={(r) => r.code}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Aucune table publique</Text>}
        renderItem={({ item }) => (
          <View style={styles.room}>
            <View>
              <Text style={styles.roomCode}>{item.code}</Text>
              <Text style={styles.roomInfo}>
                {item.players}/{item.maxPlayers} · {item.status === 'playing' ? 'en cours' : 'attente'}
              </Text>
            </View>
            <Pressable style={styles.btn} onPress={() => join(item.code, item.status === 'playing')}>
              <Text style={styles.btnText}>{item.status === 'playing' ? 'Regarder' : 'Rejoindre'}</Text>
            </Pressable>
          </View>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1410', padding: 20, paddingTop: 60 },
  gear: { position: 'absolute', top: 50, right: 16, fontSize: 24, color: '#a89880' },
  title: { color: '#f5e6c8', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  who: { color: '#a89880', textAlign: 'center', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 10 },
  btn: { backgroundColor: '#c8955c', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#1a1410', fontWeight: '700', fontSize: 15 },
  quick: { alignSelf: 'center', backgroundColor: '#3d6b4f', marginBottom: 16 },
  codeRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 16 },
  codeInput: { backgroundColor: '#2a2018', color: '#f5e6c8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, fontSize: 20, letterSpacing: 4, width: 140, textAlign: 'center' },
  list: { flex: 1 },
  empty: { color: '#8a7a60', textAlign: 'center', marginTop: 40 },
  room: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#2a2018', borderRadius: 12, padding: 14, marginBottom: 8 },
  roomCode: { color: '#f5e6c8', fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  roomInfo: { color: '#a89880', fontSize: 13 },
  error: { color: '#e05038', textAlign: 'center' },
});
