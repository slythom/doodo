// Package matchmaking : file de partie rapide. ≥3 joueurs → table ; après
// 60 s d'attente → complétion par des bots (spec fonc. §3.3).
package matchmaking

import (
	"sync"
	"time"

	"doodo/server/internal/actor"
	"doodo/server/internal/proto"
)

const (
	minPlayers   = 3
	maxPlayers   = 6
	botFillDelay = 60 * time.Second
)

// Waiting : un client en file.
type Waiting struct {
	Name     string
	ClientID string
	Send     actor.Sender
	JoinedAt time.Time
}

// Queue est la file FIFO des joueurs en partie rapide.
type Queue struct {
	mu      sync.Mutex
	waiting []*Waiting
	create  func(opts proto.TableOptions, public bool) (*actor.Actor, string, error)
	stop    chan struct{}
}

func New(create func(proto.TableOptions, bool) (*actor.Actor, string, error)) *Queue {
	q := &Queue{create: create, stop: make(chan struct{})}
	go q.loop()
	return q
}

// Join met un client en file et lui confirme sa position.
func (q *Queue) Join(w *Waiting) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, e := range q.waiting {
		if e.ClientID == w.ClientID {
			return
		}
	}
	w.JoinedAt = time.Now()
	q.waiting = append(q.waiting, w)
	w.Send(proto.NewMsg("matchmaking", 0, proto.MatchmakingPayload{
		State: "waiting", Position: len(q.waiting), Size: len(q.waiting),
	}))
}

// Leave retire un client de la file.
func (q *Queue) Leave(clientID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i, e := range q.waiting {
		if e.ClientID == clientID {
			q.waiting = append(q.waiting[:i], q.waiting[i+1:]...)
			return
		}
	}
}

// InQueue indique si un clientID attend.
func (q *Queue) InQueue(clientID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, e := range q.waiting {
		if e.ClientID == clientID {
			return true
		}
	}
	return false
}

func (q *Queue) loop() {
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-q.stop:
			return
		case <-tick.C:
			q.tick()
		}
	}
}

func (q *Queue) tick() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.waiting) == 0 {
		return
	}
	oldest := time.Since(q.waiting[0].JoinedAt)
	formBots := oldest > botFillDelay
	if len(q.waiting) < minPlayers && !formBots {
		return
	}
	// Former une table : jusqu'à maxPlayers joueurs, complétée par des bots.
	n := len(q.waiting)
	if n > maxPlayers {
		n = maxPlayers
	}
	batch := q.waiting[:n]
	q.waiting = append([]*Waiting(nil), q.waiting[n:]...)

	opts := proto.DefaultTableOptions()
	opts.MaxPlayers = maxPlayers
	a, code, err := q.create(opts, false)
	if err != nil {
		// Remettre les joueurs en file en cas d'échec.
		q.waiting = append(batch, q.waiting...)
		return
	}
	for _, w := range batch {
		w.Send(proto.NewMsg("matchmaking", 0, proto.MatchmakingPayload{State: "matched"}))
		a.Join(actor.JoinRequest{
			Name: w.Name, ClientID: w.ClientID, Send: w.Send,
		})
	}
	if formBots {
		a.EnsureBots(minPlayers)
	}
	_ = code
}
