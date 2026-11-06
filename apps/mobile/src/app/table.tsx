import '@/polyfills';
import { StyleSheet, Text, View } from 'react-native';
import { TableScene } from '@/scenes/TableScene';

export default function Table() {
  return (
    <View style={styles.container}>
      <TableScene
        players={[
          { seat: 0, name: 'Toi', isBot: false, connected: true, ready: true },
          { seat: 1, name: 'Bot 1', isBot: true, connected: true, ready: true },
          { seat: 2, name: 'Bot 2', isBot: true, connected: true, ready: true },
        ]}
        diceCounts={{ 0: 5, 1: 5, 2: 4 }}
        mySeat={0}
        yourDice={[3, 5, 1, 6, 2]}
        godDice={null}
        turnSeat={1}
        round={1}
      />
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
