import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import type { ChatEntry } from '@doodo/shared';

const EMOTES = ['👍', '😄', '😱', '🤔', '🎲', '💀'];

interface Props {
  chat: ChatEntry[];
  playerName: (seat: number) => string;
  onSend: (text?: string, emote?: string) => void;
}

export function Chat({ chat, playerName, onSend }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.toggle} onPress={() => setOpen(!open)}>
        <Text style={styles.toggleText}>💬 {chat.length > 0 && `(${chat.length})`}</Text>
      </Pressable>
      {open && (
        <View style={styles.panel}>
          <FlatList
            data={chat.slice(-20)}
            keyExtractor={(_, i) => String(i)}
            style={styles.list}
            renderItem={({ item }) => (
              <Text style={styles.msg}>
                <Text style={styles.who}>{playerName(item.from)}: </Text>
                {item.emote ?? item.text}
              </Text>
            )}
          />
          <View style={styles.emotes}>
            {EMOTES.map((e) => (
              <Pressable key={e} onPress={() => onSend(undefined, e)}>
                <Text style={styles.emote}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor="#8a7a60"
              onSubmitEditing={() => { onSend(text); setText(''); }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 8, right: 8, alignItems: 'flex-end' },
  toggle: { backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 10 },
  toggleText: { color: '#f5e6c8', fontSize: 18 },
  panel: { marginTop: 6, width: 240, maxHeight: 300, backgroundColor: 'rgba(20,14,8,0.95)', borderRadius: 10, padding: 8 },
  list: { maxHeight: 160 },
  msg: { color: '#e8dcc4', fontSize: 13, marginVertical: 2 },
  who: { color: '#c8955c', fontWeight: '700' },
  emotes: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 6 },
  emote: { fontSize: 22 },
  inputRow: { flexDirection: 'row' },
  input: { flex: 1, backgroundColor: '#2a2018', color: '#f5e6c8', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
