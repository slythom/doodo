// Package api : handlers REST (création de tables, lobby public).
package api

import (
	"encoding/json"
	"net/http"

	"doodo/server/internal/actor"
	"doodo/server/internal/hub"
	"doodo/server/internal/proto"
)

type Server struct {
	hub *hub.Hub
}

func NewServer(h *hub.Hub) *Server { return &Server{hub: h} }

type createGameRequest struct {
	Options proto.TableOptions `json:"options"`
	Public  bool               `json:"public"`
}

type createGameResponse struct {
	Code    string `json:"code"`
	JoinURL string `json:"joinUrl"`
}

// CreateGame : POST /api/games — crée une salle, retourne son code.
func (s *Server) CreateGame(w http.ResponseWriter, r *http.Request) {
	var req createGameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_request"}`, http.StatusBadRequest)
		return
	}
	if req.Options.MaxPlayers == 0 {
		req.Options = proto.DefaultTableOptions()
	}
	if req.Options.CustomRules == nil {
		req.Options.CustomRules = []string{}
	}
	a, code, err := s.hub.Create(req.Options, req.Public)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, proto.ErrorPayload{Code: "bad_options", Message: err.Error()})
		return
	}
	_ = a
	writeJSON(w, http.StatusCreated, createGameResponse{
		Code:    code,
		JoinURL: "doodo://join/" + code,
	})
}

// ListGames : GET /api/games — tables publiques (lobby).
func (s *Server) ListGames(w http.ResponseWriter, _ *http.Request) {
	rooms := s.hub.ListPublic()
	if rooms == nil {
		rooms = []actor.RoomInfo{}
	}
	writeJSON(w, http.StatusOK, rooms)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
