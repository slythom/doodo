package ws

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"doodo/server/internal/hub"
	"doodo/server/internal/matchmaking"
	"doodo/server/internal/proto"
)

type testClient struct {
	conn *websocket.Conn
	ctx  context.Context
}

func dial(t *testing.T, url string) *testClient {
	t.Helper()
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return &testClient{conn: conn, ctx: ctx}
}

func (c *testClient) send(t *testing.T, msg proto.ClientMessage) {
	t.Helper()
	ctx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, c.conn, msg); err != nil {
		t.Fatal(err)
	}
}

func (c *testClient) read(t *testing.T) proto.ServerMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
	defer cancel()
	var m proto.ServerMessage
	if err := wsjson.Read(ctx, c.conn, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// waitForTurn attend un événement turn pour un siège donné (draine les anciens).
func (c *testClient) waitForTurn(t *testing.T, seat int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		m := c.read(t)
		if m.Type == "turn" {
			var tp proto.TurnPayload
			decodePayload(t, m, &tp)
			if tp.Seat == seat {
				return
			}
		}
	}
	t.Fatalf("timeout en attendant turn seat %d", seat)
}

func (c *testClient) waitFor(t *testing.T, typ string) proto.ServerMessage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		m := c.read(t)
		if m.Type == typ {
			return m
		}
	}
	t.Fatalf("timeout en attendant %q", typ)
	return proto.ServerMessage{}
}

// decodePayload redécode le payload générique dans le type attendu.
func decodePayload(t *testing.T, m proto.ServerMessage, v any) {
	t.Helper()
	b, err := json.Marshal(m.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("decode %s payload: %v", m.Type, err)
	}
}

func mustPayload(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestWSFullFlow(t *testing.T) {
	gameHub := hub.New("admin123")
	queue := matchmaking.New(gameHub.Create)
	srv := httptest.NewServer(NewServer(gameHub, queue))
	defer srv.Close()
	wsURL := "ws" + srv.URL[4:] + "/ws"

	_, code, err := gameHub.Create(proto.DefaultTableOptions(), true)
	if err != nil {
		t.Fatal(err)
	}

	alice := dial(t, wsURL)
	bob := dial(t, wsURL)

	alice.send(t, proto.ClientMessage{Type: "join_game", Payload: mustPayload(t, proto.JoinGamePayload{
		Code: code, Name: "Alice", ClientID: "a1",
	})})
	bob.send(t, proto.ClientMessage{Type: "join_game", Payload: mustPayload(t, proto.JoinGamePayload{
		Code: code, Name: "Bob", ClientID: "b1",
	})})

	// L'ordre des joins n'est pas garanti : le créateur est seat 0,
	// Alice ou Bob selon l'arrivée.
	var jA, jB proto.JoinedPayload
	decodePayload(t, alice.waitFor(t, "joined"), &jA)
	decodePayload(t, bob.waitFor(t, "joined"), &jB)
	if jA.Seat == jB.Seat {
		t.Fatalf("même siège %d pour les deux", jA.Seat)
	}
	creator, other := alice, bob
	creatorSeat, otherSeat := jA.Seat, jB.Seat
	if jB.Seat == 0 {
		creator, other = bob, alice
		creatorSeat, otherSeat = 0, jA.Seat
	}
	// lobby_state avec 2 joueurs (le 1er ne contient qu'Alice)
	deadline := time.Now().Add(5 * time.Second)
	for {
		var ls proto.LobbyStatePayload
		decodePayload(t, alice.waitFor(t, "lobby_state"), &ls)
		if len(ls.Players) == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("lobby jamais à 2 joueurs, last=%v", ls.Players)
		}
	}

	creator.send(t, proto.ClientMessage{Type: "start_game"})
	waitRoundStarted(t, alice)
	waitRoundStarted(t, bob)

	// Tour → bid puis dudo selon le siège courant.
	var turn proto.TurnPayload
	decodePayload(t, alice.waitFor(t, "turn"), &turn)
	if turn.Seat == creatorSeat {
		creator.send(t, proto.ClientMessage{Type: "bid", Payload: mustPayload(t, proto.Bid{Qty: 9, Value: 3})})
		other.waitForTurn(t, otherSeat)
		other.send(t, proto.ClientMessage{Type: "dudo"})
	} else {
		other.send(t, proto.ClientMessage{Type: "bid", Payload: mustPayload(t, proto.Bid{Qty: 9, Value: 3})})
		creator.waitForTurn(t, creatorSeat)
		creator.send(t, proto.ClientMessage{Type: "dudo"})
	}

	var rp proto.RevealPayload
	decodePayload(t, alice.waitFor(t, "reveal"), &rp)
	if rp.Loser < 0 {
		t.Error("reveal sans perdant")
	}
	if len(rp.AllDice) != 2 {
		t.Errorf("reveal allDice=%v", rp.AllDice)
	}
	bob.waitFor(t, "reveal")
}

func waitRoundStarted(t *testing.T, c *testClient) {
	t.Helper()
	m := c.waitFor(t, "round_started")
	var rs proto.RoundStartedPayload
	decodePayload(t, m, &rs)
	if len(rs.YourDice) != 5 {
		t.Fatalf("yourDice=%v", rs.YourDice)
	}
}
