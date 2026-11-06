import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { connectToRoom, disconnect, gameStore, send, isConnected } from '@/game/connection';
import { BidSelector } from '@/components/BidSelector';
import { Chat } from '@/components/Chat';
import { ChooseDice, GodPanel } from '@/components/GodPanel';
import { DiceRow } from '@/components/Dice';
import { TableScene, cupScreenX } from '@/scenes/TableScene';
import { GameBadges, TurnTimer } from '@/components/GameWidgets';
import { useSession } from '@/store/session';
import { playEvent } from '@/audio/manager';
import type { GodAction } from '@doodo/shared';

export default function Room() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const s = useStore(gameStore);
  const session = useSession();

  useEffect(() => {
    if (!isConnected() && code) connectToRoom(code);
    return () => { disconnect(); };
  }, [code]);

  useEffect(() => {
    playEvent('round_started');
  }, [s.round]);

  const isCreator = s.mySeat === 0;
  const myTurn = s.turnSeat === s.mySeat;
  const inLobby = s.phase === 'lobby';
  const inGame = s.phase === 'bidding' || s.phase === 'resolving';
  const ended = s.phase === 'ended';
  const spectating = s.mySeat === null || (s.mySeat ?? 0) >= 100;

  const godAction = (a: GodAction) => send({ type: 'god_action', payload: a });

  return (
    <View style={styles.container}>
      {inLobby && (
        <ScrollView contentContainerStyle={styles.center}>
          <Text style={styles.code}>{s.roomCode ?? code}</Text>
          <Text style={styles.hint}>Partage ce code à tes amis</Text>
          {s.options.godMode && <Text style={styles.godBadge}>⚡ Mode dieu activé</Text>}
          <View style={styles.players}>
            {s.players.map((p) => (
              <View key={p.seat} style={styles.playerRow}>
                <Text style={styles.playerName}>
                  {p.isBot ? '🤖 ' : ''}{p.name}
                  {p.seat === 0 ? ' 👑' : ''}
                  {!p.connected && ' 📴'}
                </Text>
                <Text style={styles.ready}>{p.ready ? '✓ prêt' : ''}</Text>
              </View>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={() =>
              send({ type: 'set_ready', payload: { ready: true } })}>
              <Text style={styles.btnText}>Prêt</Text>
            </Pressable>
            {isCreator && (
              <>
                <Pressable style={styles.btn} onPress={() => send({ type: 'add_bot' })}>
                  <Text style={styles.btnText}>+ Bot</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.start]} onPress={() => send({ type: 'start_game' })}>
                  <Text style={styles.btnText}>Lancer</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {s.phase === 'god_roll' && !spectating && (
        <View style={styles.center}>
          <ChooseDice count={s.diceCounts[s.mySeat ?? 0] ?? 5} onDone={(dice) =>
            godAction({ action: 'set_dice', dice })} />
        </View>
      )}
      {s.phase === 'god_roll' && spectating && (
        <Text style={styles.centerText}>En attente des choix de dés…</Text>
      )}

      {inGame && (
        <View style={styles.game}>
          <View style={StyleSheet.absoluteFill}>
            <TableScene
              players={s.players} diceCounts={s.diceCounts} mySeat={s.mySeat}
              yourDice={s.yourDice} godDice={s.godDice}
              turnSeat={s.turnSeat} round={s.round} />
          </View>
          {/* Compte de dés au-dessus de chaque gobelet (overlay 2D, caméra fixe) */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {s.players.filter(p => p.seat !== s.mySeat && p.seat < 100).map((p, i, arr) => (
              <View key={p.seat} style={[styles.cupLabel,
                { left: `${cupScreenX(i, arr.length) * 100}%` as never }]}>
                <Text style={[styles.cupCount, s.turnSeat === p.seat && styles.cupCountTurn]}>
                  {s.diceCounts[p.seat] ?? 0}
                </Text>
                <Text style={styles.cupName} numberOfLines={1}>
                  {p.isBot ? '🤖' : ''}{p.name}{!p.connected ? ' 📴' : ''}
                </Text>
              </View>
            ))}
          </View>
          <GameBadges godMode={s.options.godMode} palifico={false} />
          <View style={styles.bidZone}>
            {s.currentBid ? (
              <Text style={styles.bid}>
                Enchère : {s.currentBid.bid.qty} × {s.currentBid.bid.value}
                <Text style={styles.bidWho}> par {s.players.find(p => p.seat === s.currentBid?.seat)?.name}</Text>
              </Text>
            ) : (
              <Text style={styles.hint}>Pas encore d’enchère</Text>
            )}
            <TurnTimer deadline={s.turnDeadline ?? 0} />
            {s.revealedDice && (
              <View style={styles.revealBox}>
                {s.players.filter(p => s.revealedDice![p.seat]).map(p => (
                  <View key={p.seat} style={styles.revealRow}>
                    <Text style={styles.revealName}>{p.name}</Text>
                    <DiceRow dice={s.revealedDice![p.seat]} size={24} />
                  </View>
                ))}
              </View>
            )}
          </View>
          <Text style={styles.turn}>
            {myTurn ? 'À toi de jouer !' : `Tour de ${s.players.find(p => p.seat === s.turnSeat)?.name ?? '…'}`}
          </Text>
          <DiceRow dice={s.yourDice} size={44} />
          {myTurn && !spectating ? (
            <BidSelector
              current={s.currentBid?.bid ?? null}
              calzaEnabled={s.options.calzaEnabled}
              disabled={false}
              onBid={(b) => send({ type: 'bid', payload: b })}
              onDudo={() => send({ type: 'dudo' })}
              onCalza={() => send({ type: 'calza' })}
            />
          ) : null}
        </View>
      )}

      {ended && (
        <View style={styles.center}>
          <Text style={styles.title}>Résultats</Text>
          {s.standings?.map((st) => (
            <Text key={st.seat} style={styles.standing}>
              {st.finalRank === 1 ? '🏆 ' : `${st.finalRank}. `}{st.name}
            </Text>
          ))}
          <View style={styles.row}>
            {isCreator && (
              <Pressable style={[styles.btn, styles.start]} onPress={() => send({ type: 'start_game' })}>
                <Text style={styles.btnText}>Revanche</Text>
              </Pressable>
            )}
            <Pressable style={styles.btn} onPress={() => { disconnect(); router.replace('/lobby'); }}>
              <Text style={styles.btnText}>Lobby</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Chat chat={s.chat} onSend={(text, emote) => send({ type: 'chat', payload: { text, emote } })}
        playerName={(seat) => seat >= 100 ? 'Spectateur' : s.players.find(p => p.seat === seat)?.name ?? `#${seat}`} />
      <GodPanel players={s.players} isAdmin={session.isAdmin} godMode={s.options.godMode}
        myDice={s.yourDice} onAction={godAction} />
      {s.lastError && <Text style={styles.error}>{s.lastError.message}</Text>}
      {inLobby && s.mySeat === null && (
        <Text style={styles.centerText}>Connexion…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1410', paddingTop: 50 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  centerText: { color: '#a89880', textAlign: 'center', marginTop: 200 },
  code: { color: '#e8b74a', fontSize: 40, fontWeight: '900', letterSpacing: 6 },
  hint: { color: '#a89880', fontSize: 14 },
  godBadge: { color: '#e8b74a', fontWeight: '800' },
  title: { color: '#f5e6c8', fontSize: 30, fontWeight: '800' },
  players: { marginVertical: 16, gap: 6, minWidth: 220 },
  playerRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#2a2018', borderRadius: 8, padding: 10 },
  playerName: { color: '#f5e6c8', fontSize: 15 },
  ready: { color: '#7da87b', fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { backgroundColor: '#c8955c', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 },
  start: { backgroundColor: '#3d6b4f' },
  btnText: { color: '#1a1410', fontWeight: '700', fontSize: 15 },
  game: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', padding: 12 },
  bidZone: { alignItems: 'center', gap: 6, marginTop: 70 },
  bid: { color: '#f5e6c8', fontSize: 22, fontWeight: '800' },
  bidWho: { color: '#a89880', fontSize: 15, fontWeight: '400' },
  revealBox: { gap: 4, alignItems: 'center' },
  revealRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  revealName: { color: '#c8955c', fontSize: 12, width: 70, textAlign: 'right' },
  cupLabel: { position: 'absolute', top: '24%', transform: [{ translateX: -30 }], alignItems: 'center', width: 60 },
  cupCount: { color: '#f5e6c8', fontSize: 20, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 4 },
  cupCountTurn: { color: '#e8b74a' },
  cupName: { color: '#a89880', fontSize: 11, textShadowColor: '#000', textShadowRadius: 3 },
  turn: { color: '#e8b74a', fontSize: 17, fontWeight: '700' },
  standing: { color: '#f5e6c8', fontSize: 20, fontWeight: '600' },
  error: { position: 'absolute', bottom: 12, alignSelf: 'center', color: '#e05038', fontSize: 13 },
});
