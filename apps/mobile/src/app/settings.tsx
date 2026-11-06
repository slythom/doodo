import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/api/http';
import { useSession } from '@/store/session';

export default function Settings() {
  const { muted, setMuted, accessToken, setTokens, username } = useSession();
  const [mode, setMode] = useState<'login' | 'register' | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [stats, setStats] = useState<{ gamesPlayed: number; gamesWon: number } | null>(null);

  const submit = async () => {
    setErr('');
    try {
      const res = mode === 'register'
        ? await api.register(name, email, pass)
        : await api.login(email, pass);
      setTokens(res.accessToken, res.refreshToken, res.user.id, res.user.isAdmin);
      setMode(null);
    } catch {
      setErr(mode === 'register' ? 'Inscription impossible' : 'Identifiants invalides');
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_HOST ?? 'localhost'}`, { headers: {} });
      void res;
    } catch { /* noop */ }
    // /api/me via Bearer
    try {
      const { HTTP_URL } = await import('@/config');
      const r = await fetch(`${HTTP_URL}/api/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) setStats(await r.json());
    } catch { /* serveur sans BDD */ }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ gap: 14 }}>
      <Text style={styles.title}>Réglages</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Son</Text>
        <Pressable style={[styles.btn, muted && styles.btnOff]} onPress={() => setMuted(!muted)}>
          <Text style={styles.btnText}>{muted ? 'Muets' : 'Activés'}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Compte</Text>
        {accessToken ? (
          <>
            <Text style={styles.label}>Connecté : {username}</Text>
            {stats ? (
              <Text style={styles.label}>{stats.gamesWon} victoires / {stats.gamesPlayed} parties</Text>
            ) : (
              <Pressable style={styles.btn} onPress={loadStats}>
                <Text style={styles.btnText}>Voir mes stats</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Text style={styles.label}>Invité — les stats ne sont pas sauvegardées</Text>
        )}
        {!accessToken && !mode && (
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={() => setMode('login')}>
              <Text style={styles.btnText}>Connexion</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => setMode('register')}>
              <Text style={styles.btnText}>Créer un compte</Text>
            </Pressable>
          </View>
        )}
        {mode && (
          <View style={{ gap: 8 }}>
            {mode === 'register' && (
              <TextInput style={styles.input} value={name} onChangeText={setName}
                placeholder="Pseudo" placeholderTextColor="#8a7a60" autoCapitalize="none" />
            )}
            <TextInput style={styles.input} value={email} onChangeText={setEmail}
              placeholder={mode === 'register' ? 'Email' : 'Email ou pseudo'}
              placeholderTextColor="#8a7a60" autoCapitalize="none" />
            <TextInput style={styles.input} value={pass} onChangeText={setPass}
              placeholder="Mot de passe (8+)" placeholderTextColor="#8a7a60" secureTextEntry />
            {err ? <Text style={styles.error}>{err}</Text> : null}
            <Pressable style={[styles.btn, styles.btnGo]} onPress={submit}>
              <Text style={styles.btnText}>Valider</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Pressable style={styles.btn} onPress={() => router.back()}>
        <Text style={styles.btnText}>Retour</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1410', padding: 20, paddingTop: 60 },
  title: { color: '#f5e6c8', fontSize: 26, fontWeight: '800', marginBottom: 10 },
  section: { backgroundColor: '#241c14', borderRadius: 12, padding: 14, gap: 10 },
  sectionTitle: { color: '#c8955c', fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { color: '#a89880', flex: 1 },
  btn: { backgroundColor: '#4a3826', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, alignSelf: 'flex-start' },
  btnOff: { backgroundColor: '#3a2c1c' },
  btnGo: { backgroundColor: '#c8955c' },
  btnText: { color: '#f5e6c8', fontWeight: '700' },
  input: { backgroundColor: '#2a2018', color: '#f5e6c8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  error: { color: '#e05038' },
});
