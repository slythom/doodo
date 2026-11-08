// Package actor : une goroutine (mailbox) par partie — sérialise toutes les
// actions, tient les timers et l'état. Serveur autoritaire (spec tech §2/§7).
package actor

import (
	"errors"
	"math/rand/v2"
	"sync"
	"time"

	"doodo/server/internal/game"
	"doodo/server/internal/proto"
)

// Sender émet un message serveur vers un client (nil pour un bot/déconnecté).
type Sender func(msg proto.ServerMessage)

const (
	phaseLobby     = "lobby"
	phaseGodRoll   = "god_roll" // attente des set_dice (mode dieu)
	phaseBidding   = "bidding"
	phaseResolving = "resolving"
	phaseEnded     = "ended"

	gracePeriod    = 90 * time.Second
	revealPause    = 20 * time.Second // filet de sécurité : tous prêts = skip
	godRollTimeout = 10 * time.Second
)

// player : un occupant de la table (humain ou bot, joueur ou spectateur).
type player struct {
	seat       int
	name       string
	clientID   string // identité de reconnexion
	userID     string // compte/invité persisté ("" si anonyme)
	admin      bool
	bot        bool
	spectator  bool
	connected  bool
	ready      bool
	send       Sender          // nil si bot/déconnecté
	dice       int             // dés restants en jeu
	presetDice []game.DieValue // tirage fixé par god set_dice
	palificoOK bool            // palifico pas encore utilisé
	isGuest    bool
	chatWindow time.Time
	chatCount  int
}

// JoinRequest décrit une demande d'entrée dans la partie.
type JoinRequest struct {
	Name      string
	ClientID  string
	UserID    string // id users si authentifié (guest ou compte)
	Admin     bool
	IsGuest   bool
	Spectator bool
	Send      Sender
	ack       chan JoinResult
}

// JoinResult est renvoyé à l'appelant de Join.
type JoinResult struct {
	Seat      int
	Spectator bool
	Err       error
}

// loggedEvent : journal des événements (audit god + futur replay).
type loggedEvent struct {
	at   time.Time
	seq  int64
	typ  string
	data any
}

// Actor gère une partie : salle d'attente, manches, timers, reconnexions.
type Actor struct {
	code     string
	opts     proto.TableOptions
	rules    *game.Rules
	public   bool
	rng      *rand.Rand
	persist  Persister // nil = pas de persistance (tests, dev sans BDD)
	gameDBID string    // id de la ligne games en cours

	inbox    chan any
	done     chan struct{}
	doneOnce sync.Once

	mu      sync.Mutex // protège Info() pendant Run — lecture seule des champs copiés
	phase   string
	players map[int]*player // seat → player (spectateurs: seat ≥ 100)
	creator int
	seq     int64
	gen     int64 // génération courante pour invalider les vieux timers
	log     []loggedEvent

	// budgets de temps (constants en prod, réduits en tests)
	graceWait      time.Duration
	revealWait     time.Duration
	godRollWait    time.Duration
	botThinkMin    time.Duration
	botThinkJitter time.Duration

	// état de manche
	round           *game.Round
	roundNum        int
	turnSeat        int
	turnDeadline    int64
	elimOrder       []int
	palificoNext    bool
	waitingDice     map[int]bool // sièges devant encore choisir leurs dés (god)
	pendingPalifico bool         // manche palifico en attente du roll différé (god)
	lastLoser       int
	readyNext       map[int]bool // sièges prêts pour la manche suivante (phase resolving)
}

// New crée un acteur. opts validé via le moteur de règles.
func New(code string, opts proto.TableOptions, public bool, rng *rand.Rand) (*Actor, error) {
	rules, err := game.NewRuleSet(game.RuleSet{
		DiceCount:    opts.DiceCount,
		PacoWild:     opts.PacoWild,
		CalzaEnabled: opts.CalzaEnabled,
		Palifico:     opts.Palifico,
		CustomRules:  opts.CustomRules,
	})
	if err != nil {
		return nil, err
	}
	if opts.MaxPlayers < 2 || opts.MaxPlayers > 6 {
		return nil, errors.New("maxPlayers hors limites (2-6)")
	}
	return &Actor{
		code: code, opts: opts, rules: rules, public: public, rng: rng,
		inbox:     make(chan any, 256),
		done:      make(chan struct{}),
		phase:     phaseLobby,
		players:   map[int]*player{},
		creator:   -1,
		graceWait: gracePeriod, revealWait: revealPause,
		godRollWait: godRollTimeout,
		botThinkMin: time.Second, botThinkJitter: 2 * time.Second,
	}, nil
}

// Run boucle sur la mailbox jusqu'à Close().
func (a *Actor) Run() {
	for {
		select {
		case <-a.done:
			return
		case ev := <-a.inbox:
			a.handle(ev)
		}
	}
}

// Close arrête l'acteur.
func (a *Actor) Close() { a.doneOnce.Do(func() { close(a.done) }) }

// Code de la salle.
func (a *Actor) Code() string { return a.code }

// Options de la table.
func (a *Actor) Options() proto.TableOptions { return a.opts }

// IsPublic indique si la salle apparaît dans le lobby public.
func (a *Actor) IsPublic() bool { return a.public }

// Persister : persistance des résultats (implémenté par internal/store).
type Persister interface {
	// GameStarted enregistre la partie au lancement → id BDD.
	GameStarted(code string, options proto.TableOptions, ranked bool, players []PlayerRecord) (string, error)
	// GameFinished enregistre les résultats finaux.
	GameFinished(gameID string, players []PlayerRecord) error
}

// PlayerRecord : un joueur à persister.
type PlayerRecord struct {
	UserID    string // "" si anonyme
	IsGuest   bool
	IsBot     bool
	Seat      int
	Name      string
	FinalRank int
}

// SetPersister branche la persistance sur l'acteur.
func (a *Actor) SetPersister(p Persister) { a.persist = p }

// EnsureBots ajoute des bots jusqu'à atteindre min joueurs (matchmaking).
func (a *Actor) EnsureBots(min int) {
	select {
	case a.inbox <- evEnsureBots{min: min}:
	default:
	}
}

// RankedSafe : la partie est-elle éligible aux stats.
func (a *Actor) RankedSafe() bool { return a.rules.RankedSafe() && !a.opts.GodMode }

// PostClientMsg achemine un message client déjà authentifié par siège.
// Le siège vient de la couche WS — jamais du payload (anti-usurpation).
func (a *Actor) PostClientMsg(seat int, msg proto.ClientMessage) {
	select {
	case a.inbox <- evClientMsg{seat: seat, msg: msg}:
	default:
	}
}

// Disconnect notifie la perte de connexion d'un clientID.
func (a *Actor) Disconnect(clientID string) {
	select {
	case a.inbox <- evDisconnected{clientID: clientID}:
	default:
	}
}

// Start lance la partie sans passer par un joueur (matchmaking, tests).
func (a *Actor) Start() {
	select {
	case a.inbox <- evForceStart{}:
	default:
	}
}

// Join synchronise une entrée dans la partie (accusé via channel).
func (a *Actor) Join(req JoinRequest) JoinResult {
	req.ack = make(chan JoinResult, 1)
	select {
	case a.inbox <- evJoin{req: req}:
	case <-a.done:
		return JoinResult{Err: errors.New("partie fermée")}
	}
	select {
	case res := <-req.ack:
		return res
	case <-a.done:
		return JoinResult{Err: errors.New("partie fermée")}
	case <-time.After(5 * time.Second):
		return JoinResult{Err: errors.New("join timeout")}
	}
}

// RoomInfo : résumé pour la liste du lobby public.
type RoomInfo struct {
	Code       string             `json:"code"`
	Players    int                `json:"players"`
	MaxPlayers int                `json:"maxPlayers"`
	Status     string             `json:"status"` // waiting | playing
	Options    proto.TableOptions `json:"options"`
}

// Info retourne le résumé de la salle (thread-safe, copie).
func (a *Actor) Info() RoomInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for _, p := range a.players {
		if !p.spectator {
			n++
		}
	}
	status := "waiting"
	if a.phase != phaseLobby && a.phase != phaseEnded {
		status = "playing"
	}
	return RoomInfo{
		Code: a.code, Players: n, MaxPlayers: a.opts.MaxPlayers,
		Status: status, Options: a.opts,
	}
}

// ─── événements internes ─────────────────────────────────────────────

type evJoin struct{ req JoinRequest }
type evClientMsg struct {
	seat int
	msg  proto.ClientMessage
}
type evDisconnected struct{ clientID string }
type evTimer struct {
	gen  int64
	kind string // turn | reveal | grace | godroll
	seat int
}
type evBotMove struct {
	gen  int64
	seat int
}
type evEnsureBots struct{ min int }
type evForceStart struct{}

func (a *Actor) handle(ev any) {
	switch e := ev.(type) {
	case evJoin:
		a.handleJoin(e.req)
	case evDisconnected:
		a.handleDisconnect(e.clientID)
	case evClientMsg:
		a.handleClientMsg(e.seat, e.msg)
	case evTimer:
		a.handleTimer(e)
	case evBotMove:
		a.handleBotMove(e)
	case evEnsureBots:
		for a.humanCount() < e.min {
			a.addBot()
		}
	case evForceStart:
		if (a.phase == phaseLobby || a.phase == phaseEnded) && a.humanCount() >= 2 {
			a.startGame()
		}
	}
}

// after planifie un timer rattaché à la génération courante.
func (a *Actor) after(d time.Duration, kind string, seat int) {
	gen := a.gen
	time.AfterFunc(d, func() {
		select {
		case a.inbox <- evTimer{gen: gen, kind: kind, seat: seat}:
		case <-a.done:
		}
	})
}

// bumpGen invalide tous les timers en attente.
func (a *Actor) bumpGen() { a.gen++ }

// ─── émission ────────────────────────────────────────────────────────

// emit construit un message séquencé et le journalise.
func (a *Actor) emit(typ string, payload any) proto.ServerMessage {
	a.seq++
	msg := proto.NewMsg(typ, a.seq, payload)
	a.log = append(a.log, loggedEvent{at: time.Now(), seq: a.seq, typ: typ, data: payload})
	if len(a.log) > 1000 {
		a.log = a.log[len(a.log)-1000:]
	}
	return msg
}

func (a *Actor) broadcast(typ string, payload any) {
	msg := a.emit(typ, payload)
	for _, p := range a.players {
		if p.connected && p.send != nil {
			p.send(msg)
		}
	}
}

func (a *Actor) sendTo(p *player, typ string, payload any) {
	if p.connected && p.send != nil {
		p.send(a.emit(typ, payload))
	}
}

func (a *Actor) sendError(p *player, code, message string) {
	a.sendTo(p, "error", proto.ErrorPayload{Code: code, Message: message})
}

// godRecipient : joueurs recevant god_state — admins, ou le créateur
// seul quand la table est en mode dieu.
func (a *Actor) godRecipient(p *player) bool {
	return p.admin || (a.opts.GodMode && p.seat == a.creator)
}

// diceInts convertit []game.DieValue → []int pour le protocole.
func diceInts(ds []game.DieValue) []int {
	out := make([]int, len(ds))
	for i, d := range ds {
		out[i] = int(d)
	}
	return out
}

func intDice(ds []int) ([]game.DieValue, bool) {
	out := make([]game.DieValue, len(ds))
	for i, d := range ds {
		if d < 1 || d > 6 {
			return nil, false
		}
		out[i] = game.DieValue(d)
	}
	return out, true
}
