package actor

import (
	"sort"
	"time"

	"doodo/server/internal/bot"
	"doodo/server/internal/game"
	"doodo/server/internal/proto"
)

// ─── Démarrage ───────────────────────────────────────────────────────

func (a *Actor) handleStart(p *player) {
	if p.seat != a.creator {
		return
	}
	if a.phase != phaseLobby && a.phase != phaseEnded {
		return
	}
	if a.humanCount() < 2 {
		a.sendError(p, "not_enough_players", "au moins 2 joueurs requis")
		return
	}
	a.startGame()
}

func (a *Actor) startGame() {
	for _, p := range a.players {
		if !p.spectator {
			p.dice = a.opts.DiceCount
			p.palificoOK = true
			p.presetDice = nil
		}
	}
	a.roundNum = 0
	a.elimOrder = nil
	a.palificoNext = false
	a.lastLoser = -1
	a.persistStart()
	a.broadcast("game_started", proto.GameStartedPayload{Options: a.opts})
	a.startRound()
}

// ─── Manches ─────────────────────────────────────────────────────────

func (a *Actor) alive() []*player {
	var out []*player
	for s := 0; s < a.opts.MaxPlayers; s++ {
		if p := a.players[s]; p != nil && !p.spectator && p.dice > 0 {
			out = append(out, p)
		}
	}
	return out
}

func (a *Actor) startRound() {
	a.roundNum++
	palifico := a.palificoNext
	a.palificoNext = false
	a.bumpGen()

	if a.opts.GodMode {
		// Mode dieu : le créateur seul choisit ses dés (spec §4.5).
		a.phase = phaseGodRoll
		a.waitingDice = map[int]bool{}
		for _, p := range a.alive() {
			if p.seat == a.creator && !p.bot && p.connected {
				a.waitingDice[p.seat] = true
				a.sendTo(p, "choose_dice", map[string]int64{
					"deadline": time.Now().Add(a.godRollWait).UnixMilli(),
				})
			}
		}
		if len(a.waitingDice) == 0 {
			// Créateur hors jeu ou déconnecté : tirage aléatoire pour tous.
			a.rollAndDeal(palifico)
			return
		}
		a.pendingPalifico = palifico
		a.after(a.godRollWait, "godroll", -1)
		return
	}
	a.rollAndDeal(palifico)
}

func (a *Actor) rollAndDeal(palifico bool) {
	dice := map[int][]game.DieValue{}
	for _, p := range a.alive() {
		ds := p.presetDice
		if len(ds) != p.dice {
			ds = make([]game.DieValue, p.dice)
			for i := range ds {
				ds[i] = game.DieValue(a.rng.IntN(6) + 1)
			}
		}
		p.presetDice = nil
		dice[p.seat] = ds
	}
	a.round = a.rules.NewRound(dice, palifico)
	a.phase = phaseBidding
	a.waitingDice = nil

	counts := map[int]int{}
	for seat, ds := range dice {
		counts[seat] = len(ds)
	}
	for _, p := range a.players {
		if !p.connected || p.send == nil {
			continue
		}
		your := []int{}
		if !p.spectator {
			your = diceInts(dice[p.seat])
		}
		a.sendTo(p, "round_started", proto.RoundStartedPayload{
			Round: a.roundNum, YourDice: your, DiceCounts: counts,
		})
	}
	a.emitGodState()

	starter := a.roundStarter()
	a.nextTurn(starter)
}

// roundStarter : le perdant de la manche précédente ouvre, sinon aléatoire.
func (a *Actor) roundStarter() int {
	if a.lastLoser >= 0 {
		if p := a.players[a.lastLoser]; p != nil && p.dice > 0 {
			return a.lastLoser
		}
		return a.nextAliveAfter(a.lastLoser)
	}
	alive := a.alive()
	return alive[a.rng.IntN(len(alive))].seat
}

func (a *Actor) nextAliveAfter(seat int) int {
	for i := 1; i <= a.opts.MaxPlayers; i++ {
		s := (seat + i) % a.opts.MaxPlayers
		if p := a.players[s]; p != nil && !p.spectator && p.dice > 0 {
			return s
		}
	}
	return -1
}

func (a *Actor) emitGodState() {
	if a.round == nil {
		return
	}
	all := map[int][]int{}
	for seat, ds := range a.round.AllDice() {
		all[seat] = diceInts(ds)
	}
	for _, p := range a.players {
		if p.connected && p.send != nil && a.godRecipient(p) {
			a.sendTo(p, "god_state", proto.GodStatePayload{AllDice: all})
		}
	}
}

func (a *Actor) roundBid() (game.Bid, int, bool) {
	if a.round == nil {
		return game.Bid{}, -1, false
	}
	return a.round.CurrentBid()
}

// ─── Tours ───────────────────────────────────────────────────────────

func (a *Actor) nextTurn(seat int) {
	if seat < 0 {
		return
	}
	a.turnSeat = seat
	a.turnDeadline = 0
	if a.opts.TurnTimer > 0 {
		a.turnDeadline = time.Now().Add(time.Duration(a.opts.TurnTimer) * time.Second).UnixMilli()
		a.after(time.Duration(a.opts.TurnTimer)*time.Second, "turn", seat)
	}
	a.broadcast("turn", proto.TurnPayload{Seat: seat, Deadline: a.turnDeadline})

	if p := a.players[seat]; p != nil && p.bot {
		delay := a.botThinkMin + time.Duration(a.rng.IntN(int(a.botThinkJitter.Milliseconds())))*time.Millisecond
		gen := a.gen
		time.AfterFunc(delay, func() {
			select {
			case a.inbox <- evBotMove{gen: gen, seat: seat}:
			case <-a.done:
			}
		})
	}
}

func (a *Actor) handleBid(p *player, pl proto.Bid) {
	if a.phase != phaseBidding || p.seat != a.turnSeat || p.spectator || p.dice <= 0 {
		return
	}
	b := game.Bid{Qty: pl.Qty, Value: game.DieValue(pl.Value)}
	if err := a.round.PlaceBid(p.seat, b); err != nil {
		a.sendError(p, "invalid_bid", err.Error())
		return
	}
	a.broadcast("bid_placed", proto.BidPlacedPayload{
		Seat: p.seat, Bid: proto.Bid{Qty: b.Qty, Value: int(b.Value)},
	})
	a.bumpGen()
	a.nextTurn(a.nextAliveAfter(p.seat))
}

func (a *Actor) handleCall(p *player, kind string) {
	if a.phase != phaseBidding || p.seat != a.turnSeat || p.spectator || p.dice <= 0 {
		return
	}
	var res game.Resolution
	var err error
	if kind == "dudo" {
		res, err = a.round.CallDudo(p.seat)
	} else {
		res, err = a.round.CallCalza(p.seat)
	}
	if err != nil {
		a.sendError(p, "invalid_call", err.Error())
		return
	}
	a.broadcast(kind+"_called", proto.CalledPayload{Seat: p.seat})
	a.resolve(res)
}

func (a *Actor) resolve(res game.Resolution) {
	a.phase = phaseResolving
	a.readyNext = map[int]bool{}
	a.bumpGen()

	all := map[int][]int{}
	for seat, ds := range a.round.AllDice() {
		all[seat] = diceInts(ds)
	}

	// Appliquer les pertes/gains.
	before := map[int]int{}
	for _, p := range a.alive() {
		before[p.seat] = p.dice
	}
	remaining := -1
	if res.Loser >= 0 {
		if p := a.players[res.Loser]; p != nil {
			p.dice -= res.DiceLost
			if p.dice < 0 {
				p.dice = 0
			}
			remaining = p.dice
		}
	}
	if res.Gainer >= 0 {
		if p := a.players[res.Gainer]; p != nil && p.dice < a.opts.DiceCount {
			p.dice++
		}
	}
	// Déclencheur Palifico (spec §1.3).
	for seat, b := range before {
		if p := a.players[seat]; p != nil && p.palificoOK && game.PalificoTrigger(b, p.dice) {
			p.palificoOK = false
			a.palificoNext = true
		}
	}
	a.lastLoser = res.Loser

	a.broadcast("reveal", proto.RevealPayload{
		AllDice: all, Matched: res.Matched, Loser: res.Loser, Remaining: remaining,
	})

	// Éliminations.
	if res.Loser >= 0 {
		if p := a.players[res.Loser]; p != nil && p.dice <= 0 {
			a.eliminate(p, "dice_lost")
		}
	}
	// Filet de sécurité : la manche suivante part dès que tous les joueurs
	// ont cliqué « manche suivante », sinon au bout de revealWait.
	a.after(a.revealWait, "reveal", -1)
}

// handleNextRound : le joueur est prêt à enchaîner. La manche démarre dès
// que tous les joueurs humains connectés encore en jeu ont cliqué.
func (a *Actor) handleNextRound(p *player) {
	if a.phase != phaseResolving || p.spectator || a.readyNext[p.seat] {
		return
	}
	a.readyNext[p.seat] = true
	seats := make([]int, 0, len(a.readyNext))
	for s := range a.readyNext {
		seats = append(seats, s)
	}
	sort.Ints(seats)
	a.broadcast("next_round_ready", proto.NextRoundReadyPayload{Seats: seats})
	a.maybeFinishReveal()
}

// nextRoundRequired : sièges devant cliquer pour abréger la révélation —
// joueurs humains connectés encore en vie (bots et spectateurs exclus).
func (a *Actor) nextRoundRequired() []int {
	var out []int
	for _, p := range a.alive() {
		if !p.bot && p.connected {
			out = append(out, p.seat)
		}
	}
	return out
}

// maybeFinishReveal enchaîne si tous les joueurs requis sont prêts. S'il
// n'y a personne à attendre (que des bots), on laisse le timer trancher.
func (a *Actor) maybeFinishReveal() {
	if a.phase != phaseResolving {
		return
	}
	req := a.nextRoundRequired()
	if len(req) == 0 {
		return
	}
	for _, s := range req {
		if !a.readyNext[s] {
			return
		}
	}
	a.finishReveal()
}

// finishReveal clôt la révélation : partie finie ou manche suivante.
func (a *Actor) finishReveal() {
	if len(a.alive()) <= 1 {
		a.finishGame()
		return
	}
	a.startRound()
}

func (a *Actor) eliminate(p *player, reason string) {
	p.dice = 0
	a.elimOrder = append(a.elimOrder, p.seat)
	rank := len(a.alive()) + 1
	a.broadcast("player_eliminated", proto.EliminatedPayload{Seat: p.seat, FinalRank: rank})
	if a.phase == phaseBidding && a.turnSeat == p.seat {
		a.bumpGen()
		a.nextTurn(a.nextAliveAfter(p.seat))
	}
	a.checkEnd()
	_ = reason
}

func (a *Actor) checkEnd() {
	if len(a.alive()) <= 1 && a.phase != phaseEnded && a.phase != phaseLobby {
		a.finishGame()
	}
}

func (a *Actor) finishGame() {
	a.phase = phaseEnded
	a.bumpGen()
	standings := make([]proto.Standing, 0, len(a.players))
	for _, p := range a.alive() {
		standings = append(standings, proto.Standing{Seat: p.seat, Name: p.name, FinalRank: 1})
	}
	for i := len(a.elimOrder) - 1; i >= 0; i-- {
		seat := a.elimOrder[i]
		if p := a.players[seat]; p != nil {
			standings = append(standings, proto.Standing{
				Seat: seat, Name: p.name, FinalRank: len(a.elimOrder) - i + 1,
			})
		}
	}
	a.broadcast("game_ended", proto.GameEndedPayload{Standings: standings})
	a.persistFinish(standings)
}

// ─── Persistance ─────────────────────────────────────────────────────

// persistStart enregistre la partie au lancement (si Persister branché).
func (a *Actor) persistStart() {
	if a.persist == nil {
		return
	}
	var players []PlayerRecord
	for _, p := range a.players {
		if !p.spectator {
			players = append(players, PlayerRecord{
				UserID: p.userID, IsGuest: p.isGuest, IsBot: p.bot,
				Seat: p.seat, Name: p.name,
			})
		}
	}
	id, err := a.persist.GameStarted(a.code, a.opts, a.RankedSafe(), players)
	if err != nil {
		a.log = append(a.log, loggedEvent{at: time.Now(), typ: "persist_error", data: err.Error()})
		return
	}
	a.gameDBID = id
}

// persistFinish enregistre les résultats finaux.
func (a *Actor) persistFinish(standings []proto.Standing) {
	if a.persist == nil || a.gameDBID == "" {
		return
	}
	rank := map[int]int{}
	for _, st := range standings {
		rank[st.Seat] = st.FinalRank
	}
	var players []PlayerRecord
	for _, p := range a.players {
		if !p.spectator {
			players = append(players, PlayerRecord{
				UserID: p.userID, IsGuest: p.isGuest, IsBot: p.bot,
				Seat: p.seat, Name: p.name, FinalRank: rank[p.seat],
			})
		}
	}
	if err := a.persist.GameFinished(a.gameDBID, players); err != nil {
		a.log = append(a.log, loggedEvent{at: time.Now(), typ: "persist_error", data: err.Error()})
	}
	a.gameDBID = ""
}

// ─── Timers ──────────────────────────────────────────────────────────

func (a *Actor) handleTimer(e evTimer) {
	if e.gen != a.gen {
		return // timer périmé
	}
	switch e.kind {
	case "turn":
		// Timeout : surenchère minimale automatique (spec §4.3).
		if a.phase != phaseBidding || a.turnSeat != e.seat {
			return
		}
		p := a.players[e.seat]
		if p == nil || p.dice <= 0 {
			return
		}
		mb := a.round.MinNextBid()
		a.handleBid(p, proto.Bid{Qty: mb.Qty, Value: int(mb.Value)})
	case "reveal":
		if a.phase != phaseResolving {
			return
		}
		a.finishReveal()
	case "grace":
		p := a.players[e.seat]
		if p != nil && !p.connected && a.inPlay() {
			a.eliminate(p, "disconnect_timeout")
		}
	case "godroll":
		a.finishGodRoll()
	}
}

// ─── Bots ────────────────────────────────────────────────────────────

func (a *Actor) handleBotMove(e evBotMove) {
	if e.gen != a.gen || a.phase != phaseBidding || a.turnSeat != e.seat {
		return
	}
	p := a.players[e.seat]
	if p == nil || !p.bot || p.dice <= 0 {
		return
	}
	opts := a.rules.Options()
	b, bidder, hasBid := a.round.CurrentBid()
	myDice := a.round.Dice(e.seat)
	others := a.round.TotalDice() - len(myDice)
	if hasBid && bidder == e.seat {
		return // ne peut pas douter sa propre enchère (sécurité)
	}
	d := bot.Decide(myDice, others, b, hasBid,
		opts.PacoWild, a.round.Palifico(), opts.CalzaEnabled,
		p.dice, a.opts.DiceCount, a.rng)
	switch d.Kind {
	case "dudo":
		a.handleCall(p, "dudo")
	case "calza":
		a.handleCall(p, "calza")
	default:
		a.handleBid(p, proto.Bid{Qty: d.Bid.Qty, Value: int(d.Bid.Value)})
	}
}

// ─── God mode ────────────────────────────────────────────────────────

func (a *Actor) handleGodAction(p *player, pl proto.GodAction) {
	canAll := p.admin
	canDice := p.admin || (a.opts.GodMode && p.seat == a.creator)
	if !canAll && !canDice {
		return
	}
	switch pl.Action {
	case "set_dice":
		if !canDice {
			return
		}
		target := p.seat
		if p.admin && pl.Seat != 0 {
			target = pl.Seat // l'admin peut fixer le tirage de n'importe quel siège
		}
		t := a.players[target]
		if t == nil || t.spectator {
			return
		}
		ds, ok := intDice(pl.Dice)
		if !ok || len(ds) != t.dice {
			a.sendError(p, "bad_dice", "tirage invalide")
			return
		}
		if a.phase == phaseGodRoll {
			t.presetDice = ds
			delete(a.waitingDice, target)
			if len(a.waitingDice) == 0 {
				a.finishGodRoll()
			}
		} else if a.phase == phaseLobby || a.phase == phaseBidding || a.phase == phaseResolving {
			// « Fixer le prochain tirage » : mémorisé jusqu'au prochain roll.
			t.presetDice = ds
		}
		a.logGod(p, pl)
	case "force_resolve":
		if !canAll || a.phase != phaseBidding {
			return
		}
		res, err := a.round.CallDudo(a.turnSeat)
		if err != nil {
			return
		}
		a.logGod(p, pl)
		a.resolve(res)
	case "kick":
		if !canAll {
			return
		}
		if t := a.players[pl.Seat]; t != nil && !t.spectator {
			a.logGod(p, pl)
			if a.inPlay() {
				a.eliminate(t, "god_kick")
			}
			delete(a.players, pl.Seat)
			a.sendTo(t, "error", proto.ErrorPayload{Code: "kicked", Message: "expulsé (admin)"})
			a.emitLobby()
		}
	case "end_game":
		if !canAll || !a.inPlay() {
			return
		}
		a.logGod(p, pl)
		a.finishGame()
	}
}

// logGod journalise chaque action god (audit — spec §8).
func (a *Actor) logGod(p *player, pl proto.GodAction) {
	a.log = append(a.log, loggedEvent{
		at: time.Now(), seq: -1, typ: "god_audit",
		data: map[string]any{"seat": p.seat, "admin": p.admin, "action": pl},
	})
}

// finishGodRoll : tous les joueurs ont choisi (ou timeout) → lancer.
func (a *Actor) finishGodRoll() {
	if a.phase != phaseGodRoll {
		return
	}
	a.bumpGen()
	a.rollAndDeal(a.pendingPalifico)
	a.pendingPalifico = false
}
