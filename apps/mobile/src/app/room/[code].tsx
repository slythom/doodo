import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { connectToRoom, disconnect, gameStore, send, isConnected } from '@/game/connection';
import { BidSelector } from '@/components/BidSelector';
import { Chat } from '@/components/Chat';
import { ChooseDice, GodPanel } from '@/components/GodPanel';
import { DiceRow } from '@/components/Dice';
import { RevealPanel } from '@/components/RevealPanel';
import { TableScene, cupScreenX, cupScreenY } from '@/scenes/TableScene';
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
          {s.options.godMode && (s.godPowers?.length ?? 0) > 0 && (
            <Text style={styles.godBadge}>⚡ Mode dieu activé</Text>
          )}
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
      {/* Mode dieu : le créateur seul reçoit choose_dice → phase god_roll.
          Les autres restent sur round_roll en attendant le lancement. */}
      {s.phase === 'round_roll' && (
        <Text style={styles.centerText}>Lancement de la manche…</Text>
      )}

      {inGame && (
        <View style={styles.game}>
          <View style={StyleSheet.absoluteFill}>
            <TableScene
              players={s.players} diceCounts={s.diceCounts} mySeat={s.mySeat}
              yourDice={s.yourDice} godDice={s.godDice}
              turnSeat={s.turnSeat} round={s.round}
              thrown={s.thrown}
              onThrow={(seat) => send({ type: 'throw_item', payload: { item: 'tomato', seat } })} />
          </View>
          {/* Compte de dés au-dessus de chaque gobelet (overlay 2D, caméra fixe) */}
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {s.players.filter(p => p.seat !== s.mySeat && p.seat < 100).map((p, i, arr) => (
              <Pressable key={p.seat} style={[styles.cupLabel,
                { left: `${Math.min(Math.max(cupScreenX(i, arr.length), 0.14), 0.86) * 100}%` as never,
                  top: `${cupScreenY(i, arr.length) * 100}%` as never }]}
                onPress={() => send({ type: 'throw_item', payload: { item: 'tomato', seat: p.seat } })}>
                <View style={[styles.cupTag, s.turnSeat === p.seat && styles.cupTagTurn]}>
                  <Text style={styles.cupCount}>{s.diceCounts[p.seat] ?? 0}</Text>
                </View>
                {s.godDice?.[p.seat] && (
                  <View style={styles.godDiceBox}>
                    <DiceRow dice={s.godDice[p.seat]} size={12} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
          <GameBadges godMode={s.options.godMode && (s.godPowers?.length ?? 0) > 0}
            palifico={false} />
          <Text style={styles.turn}>
            {myTurn ? 'À toi de jouer !' : `Tour de ${s.players.find(p => p.seat === s.turnSeat)?.name ?? '…'}`}
          </Text>
          <View style={styles.bottomGroup}>
          <View style={styles.myDice}>
            <DiceRow dice={s.yourDice.slice(0, Math.floor(s.yourDice.length / 2))} size={40} />
            <DiceRow dice={s.yourDice.slice(Math.floor(s.yourDice.length / 2))} size={40} />
          </View>
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
          </View>
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
        </View>
      )}

      {s.phase === 'resolving' && s.revealedDice && (
        <RevealPanel
          players={s.players} allDice={s.revealedDice} mySeat={s.mySeat}
          call={s.call} bid={s.currentBid}
          matched={s.resolution?.matched ?? 0}
          loser={s.resolution?.loser ?? -1}
          remaining={s.resolution?.remaining ?? -1}
          pacoWild={s.options.pacoWild}
          readySeats={s.revealReady} diceCounts={s.diceCounts}
          onNext={() => send({ type: 'next_round' })} />
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
      <GodPanel players={s.players} isAdmin={session.isAdmin}
        godMode={(s.godPowers?.length ?? 0) > 0}
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
  game: { flex: 1, alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  bottomGroup: { alignItems: 'center', gap: 10, marginBottom: 44 },
  bidZone: { alignItems: 'center', gap: 4 },
  bid: { color: '#f5e6c8', fontSize: 22, fontWeight: '800' },
  bidWho: { color: '#a89880', fontSize: 15, fontWeight: '400' },
  cupLabel: { position: 'absolute', transform: [{ translateX: '-50%' }], alignItems: 'center' },
  cupTag: { backgroundColor: 'rgba(26,20,16,0.85)', borderColor: '#c8955c', borderWidth: 1.5,
    borderRadius: 9, width: 32, height: 26, alignItems: 'center', justifyContent: 'center' },
  cupTagTurn: { borderColor: '#e8b74a', backgroundColor: 'rgba(232,183,74,0.9)' },
  cupCount: { color: '#f5e6c8', fontSize: 14, fontWeight: '800' },
  godDiceBox: { marginTop: 3, backgroundColor: 'rgba(20,14,8,0.85)', borderRadius: 6, padding: 3 },
  myDice: { alignItems: 'center', gap: 6 },
  turn: { position: 'absolute', top: '9%', alignSelf: 'center', color: '#e8b74a', fontSize: 24, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 6 },
  standing: { color: '#f5e6c8', fontSize: 20, fontWeight: '600' },
  error: { position: 'absolute', bottom: 12, alignSelf: 'center', color: '#e05038', fontSize: 13 },
});
