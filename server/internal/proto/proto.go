// Package proto définit les types du protocole WebSocket (spec tech §5),
// miroir Go de packages/shared/src/protocol.ts — garder synchronisé.
package proto

import "encoding/json"

// ─── Types partagés ──────────────────────────────────────────────────

type Bid struct {
	Qty   int `json:"qty"`
	Value int `json:"value"`
}

type TableOptions struct {
	DiceCount    int      `json:"diceCount"`
	PacoWild     bool     `json:"pacoWild"`
	CalzaEnabled bool     `json:"calzaEnabled"`
	Palifico     bool     `json:"palifico"`
	TurnTimer    int      `json:"turnTimer"` // secondes ; 0 = off
	MaxPlayers   int      `json:"maxPlayers"`
	GodMode      bool     `json:"godMode"`
	CustomRules  []string `json:"customRules"`
}

func DefaultTableOptions() TableOptions {
	return TableOptions{
		DiceCount: 5, PacoWild: true, CalzaEnabled: true,
		Palifico: true, TurnTimer: 30, MaxPlayers: 6,
	}
}

type PlayerInfo struct {
	Seat      int    `json:"seat"`
	Name      string `json:"name"`
	IsBot     bool   `json:"isBot"`
	Connected bool   `json:"connected"`
	Ready     bool   `json:"ready"`
}

type Standing struct {
	Seat      int    `json:"seat"`
	Name      string `json:"name"`
	FinalRank int    `json:"finalRank"`
}

type GodAction struct {
	Action string `json:"action"` // set_dice | force_resolve | kick | end_game
	Seat   int    `json:"seat,omitempty"`
	Dice   []int  `json:"dice,omitempty"`
}

// ─── Client → Serveur ────────────────────────────────────────────────

type ClientMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func (m *ClientMessage) Decode(v any) error { return json.Unmarshal(m.Payload, v) }

type JoinGamePayload struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	ClientID string `json:"clientId"`
	Spectate bool   `json:"spectate,omitempty"`
	AdminKey string `json:"adminKey,omitempty"`
	Token    string `json:"token,omitempty"` // access JWT → userID + is_admin
}

type ReadyPayload struct {
	Ready bool `json:"ready"`
}
type OptionsPayload struct {
	Options TableOptions `json:"options"`
}
type SeatPayload struct {
	Seat int `json:"seat"`
}
type ChatPayload struct {
	Text  string `json:"text,omitempty"`
	Emote string `json:"emote,omitempty"`
}
type QuickJoinPayload struct {
	Name     string `json:"name"`
	ClientID string `json:"clientId"`
	Token    string `json:"token,omitempty"`
}

// ─── Serveur → Client ────────────────────────────────────────────────

type ServerMessage struct {
	Type    string `json:"type"`
	Seq     int64  `json:"seq"`
	Payload any    `json:"payload,omitempty"`
}

func NewMsg(t string, seq int64, p any) ServerMessage {
	return ServerMessage{Type: t, Seq: seq, Payload: p}
}

// Payloads serveur

type JoinedPayload struct {
	Code      string `json:"code"`
	Seat      int    `json:"seat"`
	Spectator bool   `json:"spectator"`
}

type LobbyStatePayload struct {
	Players []PlayerInfo `json:"players"`
	Options TableOptions `json:"options"`
	Code    string       `json:"code"`
}

type GameStartedPayload struct {
	Options TableOptions `json:"options"`
}

type RoundStartedPayload struct {
	Round      int         `json:"round"`
	YourDice   []int       `json:"yourDice"` // filtré par destinataire ; [] pour spectateurs
	DiceCounts map[int]int `json:"diceCounts"`
}

type TurnPayload struct {
	Seat     int   `json:"seat"`
	Deadline int64 `json:"deadline"` // unix ms ; 0 si pas de timer
}

type BidPlacedPayload struct {
	Seat int `json:"seat"`
	Bid  Bid `json:"bid"`
}

type CalledPayload struct {
	Seat int `json:"seat"`
}

type RevealPayload struct {
	AllDice   map[int][]int `json:"allDice"`
	Matched   int           `json:"matched"`
	Loser     int           `json:"loser"`
	Remaining int           `json:"remaining"` // dés restants du perdant
}

type EliminatedPayload struct {
	Seat      int `json:"seat"`
	FinalRank int `json:"finalRank"`
}

type GameEndedPayload struct {
	Standings []Standing `json:"standings"`
}

type ConnEventPayload struct {
	Seat          int   `json:"seat"`
	GraceDeadline int64 `json:"graceDeadline,omitempty"`
}

type GodStatePayload struct {
	AllDice map[int][]int `json:"allDice"`
}

type GodPowersPayload struct {
	Actions []string `json:"actions"`
}

type ChatEventPayload struct {
	From  int    `json:"from"`
	Text  string `json:"text,omitempty"`
	Emote string `json:"emote,omitempty"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type MatchmakingPayload struct {
	State    string `json:"state"` // waiting | matched
	Position int    `json:"position,omitempty"`
	Size     int    `json:"size,omitempty"`
}

// ResyncPayload : snapshot complet pour un client reconnecté.
type ResyncPayload struct {
	Phase        string            `json:"phase"`
	Options      TableOptions      `json:"options"`
	Players      []PlayerInfo      `json:"players"`
	DiceCounts   map[int]int       `json:"diceCounts"`
	YourDice     []int             `json:"yourDice"`
	CurrentBid   *BidPlacedPayload `json:"currentBid"`
	TurnSeat     int               `json:"turnSeat"`
	TurnDeadline int64             `json:"turnDeadline"`
	GodDice      map[int][]int     `json:"godDice,omitempty"`
	Standings    []Standing        `json:"standings,omitempty"`
}
