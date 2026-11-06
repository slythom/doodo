import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/api/http';
import { useSession } from '@/store/session';
import { t } from '@doodo/shared';

export default function Home() {
  const { username, setUsername, setTokens, hydrate, hydrated } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void hydrate(); }, [hydrate]);

  const play = async () => {
    if (username.trim().length < 2) {
      setError('Pseudo requis (2-20 car.)');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Compte invité si le serveur a une BDD ; sinon on joue anonyme.
      const res = await api.guest(username.trim());
      setTokens(res.accessToken, res.refreshToken, res.user.id, res.user.isAdmin);
    } catch {
      // Serveur sans persistance : on joue sans token.
    }
    router.push('/lobby');
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('app.title')}</Text>
      <Text style={styles.subtitle}>Perudo en ligne</Text>
      {!hydrated ? null : (
        <>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Ton pseudo"
            placeholderTextColor="#8a7a60"
            maxLength={20}
            autoCapitalize="none"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.button, busy && { opacity: 0.5 }]} onPress={play} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? '…' : t('home.play')}</Text>
          </Pressable>
          <Link href="/table" style={styles.demo}>
            Voir la démo 3D
          </Link>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1410', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  title: { color: '#f5e6c8', fontSize: 52, fontWeight: 'bold' },
  subtitle: { color: '#a89880', fontSize: 16, marginBottom: 20 },
  input: { width: '100%', maxWidth: 320, backgroundColor: '#2a2018', color: '#f5e6c8', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, textAlign: 'center' },
  error: { color: '#e05038', fontSize: 14 },
  button: { backgroundColor: '#c8955c', paddingHorizontal: 40, paddingVertical: 16, borderRadius: 14 },
  buttonText: { color: '#1a1410', fontSize: 20, fontWeight: '800' },
  demo: { color: '#8a7a60', marginTop: 20, fontSize: 14 },
});
