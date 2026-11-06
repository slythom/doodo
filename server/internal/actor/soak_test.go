package actor

import (
	"math/rand/v2"
	"testing"
	"time"

	"doodo/server/internal/proto"
)

// Soak : parties 100% bots jusqu'à la victoire — détecte deadlocks et
// boucles infinies (spec phase 2.11).
func TestBotSoak(t *testing.T) {
	const games = 25
	for g := 0; g < games; g++ {
		opts := proto.DefaultTableOptions()
		opts.TurnTimer = 0
		opts.MaxPlayers = 4
		rng := rand.New(rand.NewPCG(uint64(g), uint64(g+1)))
		a, err := New("SOAK", opts, false, rng)
		if err != nil {
			t.Fatal(err)
		}
		a.revealWait = time.Millisecond
		a.botThinkMin, a.botThinkJitter = time.Millisecond, 2*time.Millisecond
		go a.Run()

		probe := &fakeClient{}
		a.EnsureBots(4)
		// Un « spectateur » sonde recevra game_ended.
		res := a.Join(JoinRequest{Name: "probe", ClientID: "probe", Spectator: true, Send: probe.send()})
		if res.Err != nil {
			t.Fatalf("join probe: %v", res.Err)
		}
		a.Start()

		m := waitFor(t, probe, "game_ended", 20*time.Second)
		standings := m.Payload.(proto.GameEndedPayload).Standings
		if len(standings) != 4 {
			t.Fatalf("game %d: standings=%v", g, standings)
		}
		if standings[0].FinalRank != 1 {
			t.Fatalf("game %d: pas de vainqueur rank 1", g)
		}
		a.Close()
	}
}

// Matchmaking → une partie formée par EnsureBots démarre et se joue.
func TestBotAutoStart(t *testing.T) {
	opts := proto.DefaultTableOptions()
	opts.MaxPlayers = 4
	opts.TurnTimer = 0
	a := newTestActor(t, opts)
	probe := &fakeClient{}
	if res := a.Join(JoinRequest{Name: "p", ClientID: "p", Spectator: true, Send: probe.send()}); res.Err != nil {
		t.Fatal(res.Err)
	}
	a.EnsureBots(4)
	a.Start()
	m := waitFor(t, probe, "game_ended", 20*time.Second)
	if len(m.Payload.(proto.GameEndedPayload).Standings) != 4 {
		t.Fatal("standings incomplets")
	}
}
