import { StyleSheet, Text, View } from 'react-native';
import { TableScene } from '@/scenes/TableScene';

export default function Table() {
  return (
    <View style={styles.container}>
      <TableScene />
      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.hudText}>Spike 3D — vue première personne</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1410' },
  hud: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  hudText: { color: '#f5e6c8', fontSize: 14 },
});
