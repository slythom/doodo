import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DieValue, PlayerInfo } from '@doodo/shared';
import { Die } from './Dice';

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: undefined });

export function RevealPanel({ players, allDice, mySeat, call, bid, matched, loser,
  remaining, pacoWild, readySeats, diceCounts, onNext }: {
  players: PlayerInfo[];
  allDice: Record<number, DieValue[]>;
  mySeat: number | null;
  /** Dernier appel (dudo/calza) et son auteur. */
  call: { kind: 'dudo' | 'calza'; seat: number } | null;
  /** Enchère contestée. */
  bid: { seat: number; bid: { qty: number; value: number } } | null;
  matched: number;
  /** Siège du perdant (-1 : personne, ex. calza réussi). */
  loser: number;
  /** Dés restants du perdant (-1 si pas de perdant). */
  remaining: number;
  pacoWild: boolean;
  /** Sièges ayant déjà cliqué « manche suivante ». */
  readySeats: number[];
  diceCounts: Record<number, number>;
  onNext: () => void;
}) {
  const name = (seat: number) =>
    seat === mySeat ? 'Toi' : players.find(p => p.seat === seat)?.name ?? `#${seat}`;
  const plural = (n: number) => (n > 1 ? 's' : '');

  const bidValue = (bid?.bid.value ?? 0) as DieValue;
  const bidQty = bid?.bid.qty ?? 0;
  const bidderSeat = bid?.seat ?? -1;
  const callerSeat = call?.seat ?? -1;
  const wild = pacoWild && bidValue !== 1;
  const counts = (d: DieValue) => d === bidValue || (wild && d === 1);

  // Enchérisseur, puis appelant, puis les autres (ordre des sièges).
  const seats = Object.keys(allDice).map(Number);
  const ordered = [
    ...(bidderSeat >= 0 && seats.includes(bidderSeat) ? [bidderSeat] : []),
    ...(callerSeat >= 0 && callerSeat !== bidderSeat && seats.includes(callerSeat)
      ? [callerSeat] : []),
    ...seats.filter(s => s !== bidderSeat && s !== callerSeat).sort((a, b) => a - b),
  ];

  const isCalza = call?.kind === 'calza';
  const held = matched >= bidQty;
  const title = isCalza
    ? (matched === bidQty ? 'LE PARI ÉTAIT EXACT.' : 'LE PARI N’ÉTAIT PAS EXACT.')
    : (held ? 'LE PARI TENAIT.' : 'LE PARI NE TENAIT PAS.');
  const subtitle = call && bid
    ? isCalza
      ? `${name(callerSeat)} a dit « exact ! » sur l’enchère de ${name(bidderSeat)}.`
      : `${name(callerSeat)} a douté de ${name(bidderSeat)}.`
    : '';

  const status = (seat: number) =>
    (seat === bidderSeat ? 'a parié'
      : seat === callerSeat ? (isCalza ? 'a dit exact' : 'a douté')
        : 'a attendu') + (readySeats.includes(seat) ? ' · prêt' : '');

  // Joueurs dont le clic est requis pour abréger : humains connectés en vie.
  const required = players
    .filter(p => !p.isBot && p.connected && (diceCounts[p.seat] ?? 0) > 0)
    .map(p => p.seat);
  const readyCount = required.filter(s => readySeats.includes(s)).length;
  const waitingOn = required.filter(s => !readySeats.includes(s));
  const spectator = mySeat === null || mySeat >= 100;
  const iAmReady = !spectator && readySeats.includes(mySeat);

  const banner = loser >= 0
    ? remaining <= 0
      ? `${name(loser)} perd son dernier dé — éliminé !`
      : `${name(loser)} perd un dé. Il lui reste ${remaining} dé${plural(remaining)}.`
    : isCalza ? `${name(callerSeat)} avait vu juste !` : '';

  return (
    <View style={[StyleSheet.absoluteFill, styles.fill]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.coinOuter}>
          <View style={styles.coinInner}>
            <Text style={styles.coinText}>DUDO</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

        {bid && (
          <View style={styles.bidCard}>
            <View style={styles.bidLeft}>
              <Text style={styles.bidQty}>{bidQty}</Text>
              <Die value={bidValue} size={34} />
            </View>
            <Text style={styles.bidBy}>Annoncé par {name(bidderSeat)}</Text>
          </View>
        )}

        <View style={styles.countRow}>
          <Text style={styles.countNum}>{matched}</Text>
          <Text style={styles.countLabel}> dé{plural(matched)} de {bidValue}</Text>
        </View>
        <Text style={styles.countSub}>sur la table · {bidQty} annoncé{plural(bidQty)}</Text>

        <View style={styles.rows}>
          {ordered.map(seat => (
            <View key={seat} style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowName} numberOfLines={1}>{name(seat)}</Text>
                <Text style={styles.rowStatus}>{status(seat)}</Text>
              </View>
              <View style={styles.rowDice}>
                {(allDice[seat] ?? []).map((d, i) => (
                  <Die key={i} value={d} size={26} inverted
                    dim={!counts(d)} highlight={counts(d)} />
                ))}
              </View>
              <View style={styles.rowCount}>
                <Text style={styles.rowCountText}>
                  {(allDice[seat] ?? []).filter(counts).length}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {!!banner && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        )}

        {spectator ? (
          <Text style={styles.waiting}>En attente des joueurs…</Text>
        ) : iAmReady ? (
          <View style={[styles.next, styles.nextDone]}>
            <Text style={styles.nextText}>
              ✓  PRÊT · {readyCount}/{required.length}
            </Text>
          </View>
        ) : (
          <Pressable style={styles.next} onPress={onNext}>
            <Text style={styles.nextText}>→  MANCHE SUIVANTE</Text>
          </Pressable>
        )}
        {iAmReady && waitingOn.length > 0 && (
          <Text style={styles.waiting}>
            En attente de {waitingOn.map(name).join(', ')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    backgroundColor: '#0f0b07',
    zIndex: 20,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    paddingHorizontal: 22,
    gap: 12,
  },
  coinOuter: {
    width: 92, height: 92, borderRadius: 46,
    borderWidth: 2, borderColor: '#8a4634',
    backgroundColor: '#3a1c12',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#c05038', shadowOpacity: 0.55, shadowRadius: 22,
    elevation: 10, marginBottom: 4,
  },
  coinInner: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 1.5, borderColor: '#a05a40',
    alignItems: 'center', justifyContent: 'center',
  },
  coinText: {
    color: '#e8cba0', fontFamily: SERIF, fontSize: 17,
    fontWeight: '700', letterSpacing: 3,
  },
  title: {
    color: '#f0e6d2', fontFamily: SERIF, fontSize: 26,
    fontWeight: '700', letterSpacing: 2.5, textAlign: 'center',
  },
  subtitle: {
    color: '#a89880', fontSize: 15, fontStyle: 'italic',
    textAlign: 'center', marginTop: -6,
  },
  bidCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', backgroundColor: '#1e150d',
    borderRadius: 12, borderWidth: 1, borderColor: '#4a3524',
    paddingVertical: 12, paddingHorizontal: 18, marginTop: 8,
  },
  bidLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bidQty: { color: '#d05040', fontSize: 34, fontWeight: '800' },
  bidBy: { color: '#a89880', fontSize: 13, fontStyle: 'italic' },
  countRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  countNum: { color: '#d05040', fontSize: 44, fontWeight: '800' },
  countLabel: { color: '#f0e6d2', fontSize: 20, fontWeight: '600' },
  countSub: { color: '#a89880', fontSize: 13, marginTop: -8 },
  rows: { alignSelf: 'stretch', gap: 10, marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLeft: { width: 92 },
  rowName: { color: '#f0e6d2', fontSize: 14, fontWeight: '700' },
  rowStatus: { color: '#a89880', fontSize: 11, fontStyle: 'italic' },
  rowDice: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  rowCount: {
    width: 30, height: 30, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#8a6a48',
    alignItems: 'center', justifyContent: 'center',
  },
  rowCountText: { color: '#f0e6d2', fontSize: 15, fontWeight: '700' },
  banner: {
    alignSelf: 'stretch', backgroundColor: '#241a10',
    borderRadius: 10, borderWidth: 1, borderColor: '#4a3524',
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 6,
  },
  bannerText: {
    color: '#f0e6d2', fontSize: 14, fontStyle: 'italic', textAlign: 'center',
  },
  next: {
    alignSelf: 'stretch', backgroundColor: '#e2b45e',
    borderRadius: 28, paddingVertical: 16,
    alignItems: 'center', marginTop: 8,
  },
  nextText: {
    color: '#2a1c0e', fontSize: 16, fontWeight: '800', letterSpacing: 2,
  },
  nextDone: { backgroundColor: '#8a7248' },
  waiting: { color: '#a89880', fontSize: 13, fontStyle: 'italic' },
});
