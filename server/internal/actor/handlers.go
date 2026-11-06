package actor

import (
	"errors"
	"fmt"
	"time"

	"doodo/server/internal/game"
	"doodo/server/internal/proto"
)

// ─── Join / Leave / Disconnect ───────────────────────────────────────

func (a *Actor) handleJoin(req JoinRequest) {
	res := JoinResult{}

	// Reconnexion : même clientID dans la partie → réattacher le siège.
	for _, p := range a.players {
		if p.clientID == req.ClientID && p.clientID != "" && !p.bot {
			p.send = req.Send
			p.connected = true
			if req.Admin {
				p.admin = true
			}
			res.Seat, res.Spectator = p.seat, p.spectator
			req.ack <- res
			a.sendJoined(p)
			if !p.spectator {
				a.broadcast("player_reconnected", proto.ConnEventPayload{Seat: p.seat})
			}
			a.sendTo(p, "resync", a.snapshot(p))
			a.emitLobby()
			return
		}
	}

	// Nouveau joueur.
	if req.Spectator || a.inPlay() {
		// Spectateur explicite, ou partie déjà commencée → spectateur.
		p := a.addPlayer(req, true)
		res.Seat, res.Spectator = p.seat, true
		req.ack <- res
		a.sendJoined(p)
		a.sendTo(p, "resync", a.snapshot(p))
		a.emitLobby()
		return
	}

	if a.humanCount() >= a.opts.MaxPlayers {
		req.ack <- JoinResult{Err: errors.New("salle pleine")}
		return
	}
	p := a.addPlayer(req, false)
	if a.creator < 0 {
		a.creator = p.seat
	}
	res.Seat = p.seat
	req.ack <- res
	a.sendJoined(p)
	if p.admin {
		a.sendTo(p, "god_powers", proto.GodPowersPayload{
			Actions: []string{"set_dice", "force_resolve", "kick", "end_game"},
		})
	} else if a.opts.GodMode {
		a.sendTo(p, "god_powers", proto.GodPowersPayload{Actions: []string{"set_dice"}})
	}
	a.emitLobby()
}

func (a *Actor) addPlayer(req JoinRequest, spectator bool) *player {
	seat := a.freeSeat(spectator)
	p := &player{
		seat: seat, name: req.Name, clientID: req.ClientID,
		admin: req.Admin && !spectator, spectator: spectator,
		connected: true, send: req.Send,
		dice: a.opts.DiceCount, palificoOK: true,
	}
	a.players[seat] = p
	return p
}

// freeSeat : joueurs 0..maxPlayers-1, spectateurs à partir de 100.
func (a *Actor) freeSeat(spectator bool) int {
	if spectator {
		for s := 100; ; s++ {
			if a.players[s] == nil {
				return s
			}
		}
	}
	for s := 0; s < a.opts.MaxPlayers; s++ {
		if a.players[s] == nil {
			return s
		}
	}
	return -1
}

func (a *Actor) sendJoined(p *player) {
	a.sendTo(p, "joined", proto.JoinedPayload{
		Code: a.code, Seat: p.seat, Spectator: p.spectator,
	})
}

func (a *Actor) humanCount() int {
	n := 0
	for _, p := range a.players {
		if !p.spectator {
			n++
		}
	}
	return n
}

func (a *Actor) inPlay() bool {
	return a.phase != phaseLobby && a.phase != phaseEnded
}

func (a *Actor) handleDisconnect(clientID string) {
	for _, p := range a.players {
		if p.clientID == clientID {
			p.connected = false
			p.send = nil
			if p.spectator {
				delete(a.players, p.seat)
				a.emitLobby()
				return
			}
			if a.phase == phaseLobby {
				delete(a.players, p.seat)
				a.fixCreator()
				a.emitLobby()
				return
			}
			// En jeu : ses dés restent en jeu, délai de grâce 90 s (spec §4.3).
			deadline := time.Now().Add(gracePeriod).UnixMilli()
			a.broadcast("player_disconnected", proto.ConnEventPayload{
				Seat: p.seat, GraceDeadline: deadline,
			})
			a.after(gracePeriod, "grace", p.seat)
			return
		}
	}
}

func (a *Actor) fixCreator() {
	if a.players[a.creator] != nil {
		return
	}
	a.creator = -1
	for s := 0; s < a.opts.MaxPlayers; s++ {
		if p := a.players[s]; p != nil && !p.bot {
			a.creator = s
			return
		}
	}
}

// ─── Dispatch des messages client ────────────────────────────────────

func (a *Actor) handleClientMsg(seat int, msg proto.ClientMessage) {
	p := a.players[seat]
	if p == nil {
		return
	}
	switch msg.Type {
	case "leave_game":
		a.handleLeave(p)
	case "set_ready":
		var pl proto.ReadyPayload
		if msg.Decode(&pl) == nil && a.phase == phaseLobby && !p.spectator {
			p.ready = pl.Ready
			a.emitLobby()
		}
	case "update_options":
		var pl proto.OptionsPayload
		if msg.Decode(&pl) == nil {
			a.handleUpdateOptions(p, pl.Options)
		}
	case "add_bot":
		a.handleAddBot(p)
	case "remove_bot":
		var pl proto.SeatPayload
		if msg.Decode(&pl) == nil {
			a.handleRemoveBot(p, pl.Seat)
		}
	case "kick":
		var pl proto.SeatPayload
		if msg.Decode(&pl) == nil {
			a.handleKick(p, pl.Seat)
		}
	case "start_game":
		a.handleStart(p)
	case "bid":
		var pl proto.Bid
		if msg.Decode(&pl) == nil {
			a.handleBid(p, pl)
		}
	case "dudo":
		a.handleCall(p, "dudo")
	case "calza":
		a.handleCall(p, "calza")
	case "god_action":
		var pl proto.GodAction
		if msg.Decode(&pl) == nil {
			a.handleGodAction(p, pl)
		}
	case "chat":
		var pl proto.ChatPayload
		if msg.Decode(&pl) == nil {
			a.handleChat(p, pl)
		}
	}
}

func (a *Actor) handleLeave(p *player) {
	if p.spectator || a.phase == phaseLobby || a.phase == phaseEnded {
		delete(a.players, p.seat)
		a.fixCreator()
		a.emitLobby()
		return
	}
	// Abandon en cours de partie = élimination (spec §4.3).
	p.connected = false
	p.send = nil
	a.eliminate(p, "abandon")
}

func (a *Actor) handleUpdateOptions(p *player, opts proto.TableOptions) {
	if p.seat != a.creator || a.phase != phaseLobby {
		return
	}
	if _, err := game.NewRuleSet(game.RuleSet{
		DiceCount:    opts.DiceCount,
		PacoWild:     opts.PacoWild,
		CalzaEnabled: opts.CalzaEnabled,
		Palifico:     opts.Palifico,
		CustomRules:  opts.CustomRules,
	}); err != nil {
		a.sendError(p, "bad_options", err.Error())
		return
	}
	if opts.MaxPlayers < 2 || opts.MaxPlayers > 6 {
		a.sendError(p, "bad_options", "maxPlayers hors limites (2-6)")
		return
	}
	a.opts = opts
	a.emitLobby()
}

func (a *Actor) handleAddBot(p *player) {
	if p.seat != a.creator || a.phase != phaseLobby {
		return
	}
	a.addBot()
}

// addBot insère un bot sur le premier siège libre.
func (a *Actor) addBot() {
	if a.humanCount() >= a.opts.MaxPlayers {
		return
	}
	seat := a.freeSeat(false)
	if seat < 0 {
		return
	}
	a.players[seat] = &player{
		seat: seat, name: fmt.Sprintf("Bot %d", seat),
		clientID: fmt.Sprintf("__bot_%d", seat),
		bot:      true, connected: true, ready: true,
		dice: a.opts.DiceCount, palificoOK: true,
	}
	a.emitLobby()
}

func (a *Actor) handleRemoveBot(p *player, seat int) {
	if p.seat != a.creator || a.phase != phaseLobby {
		return
	}
	if target := a.players[seat]; target != nil && target.bot {
		delete(a.players, seat)
		a.emitLobby()
	}
}

func (a *Actor) handleKick(p *player, seat int) {
	if p.seat != a.creator || a.phase != phaseLobby {
		return
	}
	if target := a.players[seat]; target != nil && !target.bot {
		a.sendTo(target, "error", proto.ErrorPayload{Code: "kicked", Message: "expulsé de la salle"})
		delete(a.players, seat)
		a.emitLobby()
	}
}

func (a *Actor) handleChat(p *player, pl proto.ChatPayload) {
	if len(pl.Text) > 200 {
		pl.Text = pl.Text[:200]
	}
	// Anti-spam : 10 messages / 10 s.
	now := time.Now()
	if now.Sub(p.chatWindow) > 10*time.Second {
		p.chatWindow, p.chatCount = now, 0
	}
	p.chatCount++
	if p.chatCount > 10 {
		return
	}
	if pl.Text == "" && pl.Emote == "" {
		return
	}
	a.broadcast("chat", proto.ChatEventPayload{
		From: p.seat, Text: pl.Text, Emote: pl.Emote,
	})
}

func (a *Actor) emitLobby() {
	payload := proto.LobbyStatePayload{
		Options: a.opts,
		Code:    a.code,
		Players: make([]proto.PlayerInfo, 0, len(a.players)),
	}
	for s := 0; s < a.opts.MaxPlayers; s++ {
		if p := a.players[s]; p != nil {
			payload.Players = append(payload.Players, proto.PlayerInfo{
				Seat: p.seat, Name: p.name, IsBot: p.bot,
				Connected: p.connected, Ready: p.ready,
			})
		}
	}
	a.broadcast("lobby_state", payload)
}

// snapshot construit l'état complet pour resync (reconnexion/spectateur).
func (a *Actor) snapshot(p *player) proto.ResyncPayload {
	snap := proto.ResyncPayload{
		Phase:      a.phase,
		Options:    a.opts,
		Players:    make([]proto.PlayerInfo, 0, len(a.players)),
		DiceCounts: map[int]int{},
		TurnSeat:   -1,
	}
	for s := 0; s < a.opts.MaxPlayers; s++ {
		if pl := a.players[s]; pl != nil {
			snap.Players = append(snap.Players, proto.PlayerInfo{
				Seat: pl.seat, Name: pl.name, IsBot: pl.bot,
				Connected: pl.connected, Ready: pl.ready,
			})
			snap.DiceCounts[pl.seat] = pl.dice
		}
	}
	if a.inPlay() && a.round != nil && !p.spectator {
		snap.YourDice = diceInts(a.round.Dice(p.seat))
	}
	if b, bidder, ok := a.roundBid(); ok {
		snap.CurrentBid = &proto.BidPlacedPayload{
			Seat: bidder, Bid: proto.Bid{Qty: b.Qty, Value: int(b.Value)},
		}
	}
	snap.TurnSeat = a.turnSeat
	snap.TurnDeadline = a.turnDeadline
	if a.godRecipient(p) && a.round != nil {
		snap.GodDice = map[int][]int{}
		for seat, ds := range a.round.AllDice() {
			snap.GodDice[seat] = diceInts(ds)
		}
	}
	return snap
}
