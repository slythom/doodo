import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '@doodo/shared';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('app.title')}</Text>
      <Text style={styles.subtitle}>Perudo en ligne — spike 3D</Text>
      <Link href="/table" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Voir la table 3D</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1410',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  title: { color: '#f5e6c8', fontSize: 48, fontWeight: 'bold' },
  subtitle: { color: '#a89880', fontSize: 16, marginBottom: 24 },
  button: {
    backgroundColor: '#c8955c',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: { color: '#1a1410', fontSize: 18, fontWeight: '700' },
});
