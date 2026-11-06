package store

import (
	"context"
	"encoding/json"
	"time"

	"doodo/server/internal/actor"
	"doodo/server/internal/proto"
)

// Persister adapte Store à l'interface actor.Persister.
type Persister struct {
	s *Store
}

func NewPersister(s *Store) *Persister { return &Persister{s: s} }

// GameStarted insère la ligne games au lancement.
func (p *Persister) GameStarted(code string, options proto.TableOptions, ranked bool, players []actor.PlayerRecord) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	opts, err := json.Marshal(options)
	if err != nil {
		return "", err
	}
	var createdBy *string
	for _, pl := range players {
		if pl.Seat == 0 && pl.UserID != "" {
			createdBy = &pl.UserID
		}
	}
	return p.s.InsertGame(ctx, code, opts, ranked, createdBy)
}

// GameFinished enregistre les résultats + stats.
func (p *Persister) GameFinished(gameID string, players []actor.PlayerRecord) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := p.s.FinishGame(ctx, gameID); err != nil {
		return err
	}
	results := make([]PlayerResult, 0, len(players))
	for _, pl := range players {
		var uid *string
		if pl.UserID != "" {
			uid = &pl.UserID
		}
		results = append(results, PlayerResult{
			UserID: uid, IsBot: pl.IsBot, Seat: pl.Seat, FinalRank: pl.FinalRank,
		})
	}
	return p.s.SaveGameResults(ctx, gameID, results)
}
