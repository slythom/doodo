// Package hub : registry des parties actives, génération des codes, lobby public.
package hub

import (
	"crypto/rand"
	"sync"

	"doodo/server/internal/actor"
	"doodo/server/internal/proto"

	mrand "math/rand/v2"
)

// alphabet sans caractères ambigus (0/O, 1/I/L).
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const codeLen = 6

type Hub struct {
	mu       sync.Mutex
	games    map[string]*actor.Actor
	rng      *mrand.Rand
	adminKey string
	persist  actor.Persister
}

func New(adminKey string) *Hub {
	return &Hub{
		games:    map[string]*actor.Actor{},
		rng:      mrand.New(mrand.NewPCG(mrand.Uint64(), mrand.Uint64())),
		adminKey: adminKey,
	}
}

// SetPersister branche la persistance sur les parties créées.
func (h *Hub) SetPersister(p actor.Persister) { h.persist = p }

// AdminKey vérifie la clé admin (god powers — flag users.is_admin en phase 3).
func (h *Hub) AdminKey(key string) bool {
	return h.adminKey != "" && key == h.adminKey
}

// Create crée une partie et retourne son code.
func (h *Hub) Create(opts proto.TableOptions, public bool) (*actor.Actor, string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	code := h.genCode()
	a, err := actor.New(code, opts, public, h.rng)
	if err != nil {
		return nil, "", err
	}
	a.SetPersister(h.persist)
	h.games[code] = a
	go a.Run()
	return a, code, nil
}

// Get retourne l'acteur d'une salle par son code.
func (h *Hub) Get(code string) *actor.Actor {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.games[code]
}

// Remove retire une salle (fin de partie / salle vide).
func (h *Hub) Remove(code string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if a := h.games[code]; a != nil {
		a.Close()
		delete(h.games, code)
	}
}

// ListPublic liste les tables publiques pour le lobby.
func (h *Hub) ListPublic() []actor.RoomInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []actor.RoomInfo
	for _, a := range h.games {
		if info := a.Info(); info.Status != "" && a.IsPublic() {
			out = append(out, info)
		}
	}
	return out
}

func (h *Hub) genCode() string {
	b := make([]byte, codeLen)
	_, _ = rand.Read(b)
	for {
		code := make([]byte, codeLen)
		for i := range code {
			code[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
		}
		if h.games[string(code)] == nil {
			return string(code)
		}
		_, _ = rand.Read(b)
	}
}
