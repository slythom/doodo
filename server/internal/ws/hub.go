// Package ws gère les connexions WebSocket et le routage vers les parties.
package ws

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

// Hub enregistre les connexions actives et les route vers les GameActors.
// Phase 2 : routage par partie, broadcast filtré par destinataire.
type Hub struct{}

func NewHub() *Hub { return &Hub{} }

// ServeHTTP upge la connexion puis la maintient en vie (ping/pong).
// Phase 2 : authentifier, associer à une partie, dispatcher les messages.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // TODO phase 3 : vérifier Origin + token auth
	})
	if err != nil {
		slog.Warn("ws accept failed", "err", err)
		return
	}
	defer func() { _ = conn.CloseNow() }()

	ctx := conn.CloseRead(r.Context())
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			if err := conn.Ping(ctx); err != nil {
				return
			}
		}
	}
}
