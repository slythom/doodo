package actor

import (
	"encoding/json"
	"math/rand/v2"
	"sync"
	"testing"
	"time"

	"doodo/server/internal/proto"
)

// fakeClient capture les messages envoyés à un joueur.
type fakeClient struct {
	mu     sync.Mutex
	msgs   []proto.ServerMessage
	cursor int
}

func (f *fakeClient) send() Sender {
	return func(m proto.ServerMessage) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.msgs = append(f.msgs, m)
	}
}

// drain retourne les messages reçus depuis le dernier appel (curseur).
func (f *fakeClient) drain() []proto.ServerMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := append([]proto.ServerMessage(nil), f.msgs[f.cursor:]...)
	f.cursor = len(f.msgs)
	return out
}

func (f *fakeClient) ofType(t string) []proto.ServerMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []proto.ServerMessage
	for _, m := range f.msgs {
		if m.Type == t {
			out = append(out, m)
		}
	}
	return out
}

func (f *fakeClient) last(t string) *proto.ServerMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.msgs) - 1; i >= 0; i-- {
		if f.msgs[i].Type == t {
			return &f.msgs[i]
		}
	}
	return nil
}

func newTestActor(t *testing.T, opts proto.TableOptions) *Actor {
	t.Helper()
	if opts.MaxPlayers == 0 {
		opts = proto.DefaultTableOptions()
		opts.TurnTimer = 0
	}
	rng := rand.New(rand.NewPCG(42, 99))
	a, err := New("TESTXX", opts, false, rng)
	if err != nil {
		t.Fatal(err)
	}
	a.revealWait = 5 * time.Millisecond
	a.graceWait = 200 * time.Millisecond
	a.botThinkMin, a.botThinkJitter = time.Millisecond, time.Millisecond
	go a.Run()
	t.Cleanup(a.Close)
	return a
}

func join(t *testing.T, a *Actor, c *fakeClient, name, cid string) int {
	t.Helper()
	res := a.Join(JoinRequest{Name: name, ClientID: cid, Send: c.send()})
	if res.Err != nil {
		t.Fatalf("join %s: %v", name, res.Err)
	}
	return res.Seat
}

func waitFor(t *testing.T, c *fakeClient, typ string, timeout time.Duration) proto.ServerMessage {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if m := c.last(typ); m != nil {
			return *m
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timeout en attendant %q", typ)
	return proto.ServerMessage{}
}

// Partie complète 2 joueurs : à chaque tour le joueur courant dit Dudo —
// les dés fondent jusqu'à la victoire.
func TestFullGame(t *testing.T) {
	a := newTestActor(t, proto.TableOptions{})
	c0, c1 := &fakeClient{}, &fakeClient{}
	s0 := join(t, a, c0, "Alice", "c0")
	s1 := join(t, a, c1, "Bob", "c1")
	if s0 != 0 || s1 != 1 {
		t.Fatalf("seats %d,%d", s0, s1)
	}

	a.PostClientMsg(s0, proto.ClientMessage{Type: "start_game"})
	waitFor(t, c0, "round_started", 2*time.Second)
	waitFor(t, c1, "round_started", 2*time.Second)

	// Boucle de jeu : ouvre avec une enchère min, puis dudo dès qu'il y
	// a une enchère — les dés fondent jusqu'à la victoire.
	seats := map[int]*fakeClient{s0: c0, s1: c1}
	bidSeen := map[int]bool{}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		for seat, cl := range seats {
			for _, m := range cl.drain() {
				switch m.Type {
				case "round_started":
					bidSeen[seat] = false
				case "bid_placed":
					bidSeen[seat] = true
				case "turn":
					if m.Payload.(proto.TurnPayload).Seat == seat {
						if bidSeen[seat] {
							a.PostClientMsg(seat, proto.ClientMessage{Type: "dudo"})
						} else {
							p, _ := mustJSON(proto.Bid{Qty: 1, Value: 1})
							a.PostClientMsg(seat, proto.ClientMessage{Type: "bid", Payload: p})
						}
					}
				case "game_ended":
					standings := m.Payload.(proto.GameEndedPayload).Standings
					if len(standings) != 2 {
						t.Fatalf("standings=%v", standings)
					}
					if standings[0].FinalRank != 1 {
						t.Errorf("rank1=%d", standings[0].FinalRank)
					}
					return
				}
			}
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("partie non terminée en 15 s")
}

// « Manche suivante » : la révélation ne s'abrège que lorsque tous les
// joueurs humains connectés ont cliqué ; sinon le timer tranche.
func TestNextRoundGate(t *testing.T) {
	a := newTestActor(t, proto.TableOptions{})
	a.revealWait = 10 * time.Second // sans le gate, le test échouerait par timeout
	c0, c1 := &fakeClient{}, &fakeClient{}
	s0 := join(t, a, c0, "Alice", "c0")
	s1 := join(t, a, c1, "Bob", "c1")

	a.PostClientMsg(s0, proto.ClientMessage{Type: "start_game"})
	waitFor(t, c0, "round_started", 2*time.Second)

	// Enchère min du joueur de tour, puis dudo de l'autre.
	bidder := waitFor(t, c0, "turn", 2*time.Second).Payload.(proto.TurnPayload).Seat
	doubter := s0 + s1 - bidder
	p, _ := mustJSON(proto.Bid{Qty: 1, Value: 1})
	a.PostClientMsg(bidder, proto.ClientMessage{Type: "bid", Payload: p})
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if m := c0.last("turn"); m != nil && m.Payload.(proto.TurnPayload).Seat == doubter {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	a.PostClientMsg(doubter, proto.ClientMessage{Type: "dudo"})
	waitFor(t, c0, "reveal", 2*time.Second)

	if n := len(c0.ofType("round_started")); n != 1 {
		t.Fatalf("round_started=%d, attendu 1", n)
	}

	// Un seul clic → statut broadcast, mais la manche ne part pas.
	a.PostClientMsg(s0, proto.ClientMessage{Type: "next_round"})
	ready := waitFor(t, c1, "next_round_ready", 2*time.Second)
	seats := ready.Payload.(proto.NextRoundReadyPayload).Seats
	if len(seats) != 1 || seats[0] != s0 {
		t.Fatalf("next_round_ready seats=%v, attendu [%d]", seats, s0)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(c0.ofType("round_started")); n != 1 {
		t.Fatalf("manche lancée sans unanimité (round_started=%d)", n)
	}

	// Deuxième clic → la manche suivante part immédiatement.
	a.PostClientMsg(s1, proto.ClientMessage{Type: "next_round"})
	deadline = time.Now().Add(2 * time.Second)
	for len(c0.ofType("round_started")) < 2 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	if len(c0.ofType("round_started")) < 2 {
		t.Fatal("manche suivante absente après le clic de tous les joueurs")
	}
}

// Reconnexion en cours de partie : resync avec l'état courant.
func TestReconnectResync(t *testing.T) {
	a := newTestActor(t, proto.TableOptions{})
	c0, c1 := &fakeClient{}, &fakeClient{}
	join(t, a, c0, "Alice", "c0")
	join(t, a, c1, "Bob", "c1")
	a.PostClientMsg(0, proto.ClientMessage{Type: "start_game"})
	waitFor(t, c0, "round_started", 2*time.Second)

	a.Disconnect("c1")
	waitFor(t, c0, "player_disconnected", 2*time.Second)

	c1b := &fakeClient{}
	res := a.Join(JoinRequest{Name: "Bob", ClientID: "c1", Send: c1b.send()})
	if res.Err != nil || res.Seat != 1 {
		t.Fatalf("rejoin: %+v", res)
	}
	resync := waitFor(t, c1b, "resync", 2*time.Second)
	snap := resync.Payload.(proto.ResyncPayload)
	if len(snap.YourDice) != 5 {
		t.Errorf("resync yourDice=%v", snap.YourDice)
	}
	if snap.DiceCounts[1] != 5 {
		t.Errorf("resync diceCounts=%v", snap.DiceCounts)
	}
}

// God mode de table : set_dice puis god_state visible de tous.
func TestGodModeTable(t *testing.T) {
	opts := proto.DefaultTableOptions()
	opts.GodMode = true
	opts.TurnTimer = 0
	a := newTestActor(t, opts)
	c0, c1 := &fakeClient{}, &fakeClient{}
	join(t, a, c0, "Alice", "c0")
	join(t, a, c1, "Bob", "c1")

	a.PostClientMsg(0, proto.ClientMessage{Type: "start_game"})
	waitFor(t, c0, "choose_dice", 2*time.Second)

	payload, _ := mustJSON(proto.GodAction{Action: "set_dice", Dice: []int{1, 1, 1, 1, 1}})
	a.PostClientMsg(0, proto.ClientMessage{Type: "god_action", Payload: payload})
	a.PostClientMsg(1, proto.ClientMessage{Type: "god_action", Payload: payload})

	msg := waitFor(t, c0, "round_started", 2*time.Second)
	rs := msg.Payload.(proto.RoundStartedPayload)
	if len(rs.YourDice) != 5 || rs.YourDice[0] != 1 {
		t.Errorf("dés imposés non appliqués: %v", rs.YourDice)
	}
	if g := c0.last("god_state"); g == nil {
		t.Error("god_state absent en mode dieu")
	}
	if g := c1.last("god_state"); g == nil {
		t.Error("god_state absent pour p1")
	}
}

func mustJSON(v any) (b []byte, err error) {
	return json.Marshal(v)
}
