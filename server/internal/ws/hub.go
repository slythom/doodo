// Package ws : connexions WebSocket — lecture/écriture, routage des messages
// vers le hub (join/matchmaking) ou l'acteur de la partie (spec tech §5).
package ws

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"doodo/server/internal/actor"
	"doodo/server/internal/hub"
	"doodo/server/internal/matchmaking"
	"doodo/server/internal/proto"
)

const sendBuffer = 64

// Server expose le handler /ws.
type Server struct {
	hub *hub.Hub
	mm  *matchmaking.Queue
}

func NewServer(h *hub.Hub, mm *matchmaking.Queue) *Server {
	return &Server{hub: h, mm: mm}
}

// client : une connexion WS active.
type client struct {
	conn      *websocket.Conn
	send      chan proto.ServerMessage
	hub       *hub.Hub
	mm        *matchmaking.Queue
	clientID  string
	game      *actor.Actor
	seat      int
	spectator bool
}

// sendFunc retourne le Sender thread-safe du client (drop si buffer plein).
func (c *client) sendFunc() actor.Sender {
	return func(msg proto.ServerMessage) {
		select {
		case c.send <- msg:
		default:
			// Client trop lent : on ferme plutôt que de bloquer l'acteur.
			_ = c.conn.Close(websocket.StatusPolicyViolation, "slow consumer")
		}
	}
}

// ServeHTTP upgrade la connexion et lance les pumps.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // TODO phase 3 : Origin + token auth
	})
	if err != nil {
		slog.Warn("ws accept failed", "err", err)
		return
	}
	c := &client{
		conn: conn,
		send: make(chan proto.ServerMessage, sendBuffer),
		hub:  s.hub,
		mm:   s.mm,
		seat: -1,
	}
	go c.writePump()
	c.readPump(r.Context())
}

// readPump lit les messages JSON jusqu'à la fermeture.
func (c *client) readPump(ctx context.Context) {
	defer func() {
		if c.game != nil && c.clientID != "" {
			c.game.Disconnect(c.clientID)
		}
		if c.clientID != "" {
			c.mm.Leave(c.clientID)
		}
		_ = c.conn.Close(websocket.StatusNormalClosure, "bye")
		close(c.send)
	}()
	for {
		var msg proto.ClientMessage
		err := wsjson.Read(ctx, c.conn, &msg)
		if err != nil {
			return // déconnexion
		}
		c.route(msg)
	}
}

// writePump sérialise les messages sortants + ping keepalive.
func (c *client) writePump() {
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := wsjson.Write(ctx, c.conn, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = c.conn.Ping(ctx)
			cancel()
		}
	}
}

// route dispatche un message entrant.
func (c *client) route(msg proto.ClientMessage) {
	switch msg.Type {
	case "join_game":
		var pl proto.JoinGamePayload
		if msg.Decode(&pl) != nil {
			c.sendErr("bad_request", "payload join_game invalide")
			return
		}
		c.handleJoin(pl)
	case "quick_join":
		var pl proto.QuickJoinPayload
		if msg.Decode(&pl) != nil {
			c.sendErr("bad_request", "payload quick_join invalide")
			return
		}
		c.clientID = pl.ClientID
		c.mm.Join(&matchmaking.Waiting{
			Name: pl.Name, ClientID: pl.ClientID, Send: c.sendFunc(),
		})
	case "quick_leave":
		c.mm.Leave(c.clientID)
	case "ping":
		c.deliver(proto.NewMsg("pong", 0, map[string]any{}))
	default:
		if c.game != nil {
			c.game.PostClientMsg(c.seat, msg)
		}
	}
}

func (c *client) handleJoin(pl proto.JoinGamePayload) {
	a := c.hub.Get(pl.Code)
	if a == nil {
		c.sendErr("not_found", "salle introuvable")
		return
	}
	c.clientID = pl.ClientID
	res := a.Join(actor.JoinRequest{
		Name:      pl.Name,
		ClientID:  pl.ClientID,
		Admin:     c.hub.AdminKey(pl.AdminKey),
		Spectator: pl.Spectate,
		Send:      c.sendFunc(),
	})
	if res.Err != nil {
		c.sendErr("join_failed", res.Err.Error())
		return
	}
	c.game, c.seat, c.spectator = a, res.Seat, res.Spectator
}

func (c *client) deliver(msg proto.ServerMessage) {
	select {
	case c.send <- msg:
	default:
	}
}

func (c *client) sendErr(code, message string) {
	c.deliver(proto.NewMsg("error", 0, proto.ErrorPayload{Code: code, Message: message}))
}
