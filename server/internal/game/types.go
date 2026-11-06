// Package game contient les règles pures du Perudo : enchères, Dudo, Calza,
// Palifico, registry de règles personnalisées. Aucune IO ici (cf. spec tech §7).
package game

// DieValue est la valeur d'une face de dé : 1 à 6. 1 = Paco.
type DieValue int

const (
	Paco    DieValue = 1
	Two     DieValue = 2
	Three   DieValue = 3
	Four    DieValue = 4
	Five    DieValue = 5
	Six     DieValue = 6
	minDice          = 3 // dés de départ min configurables
	maxDice          = 5 // dés de départ max configurables
)

// Bid est une enchère : « il y a au moins Qty dés de valeur Value sur la table ».
type Bid struct {
	Qty   int
	Value DieValue
}

// Resolution est le résultat d'un Dudo ou d'un Calza.
type Resolution struct {
	Caller   int  // siège ayant appelé Dudo/Calza
	Bidder   int  // siège de l'enchérisseur
	Bid      Bid  // enchère contestée
	Matched  int  // dés réellement comptés
	Exact    bool // Matched == Bid.Qty
	Loser    int  // siège qui perd DiceLost dés ; -1 si personne
	Gainer   int  // siège qui regagne 1 dé ; -1 si personne
	DiceLost int  // nb de dés perdus par Loser (≥1 ; règles perso peuvent l'augmenter)
}

// RuleSet est la config des règles d'une table (spec fonc. §1.3 + §1.5).
// Sérialisable telle quelle dans games.options.
type RuleSet struct {
	DiceCount    int      `json:"diceCount"`
	PacoWild     bool     `json:"pacoWild"`
	CalzaEnabled bool     `json:"calzaEnabled"`
	Palifico     bool     `json:"palifico"`
	CustomRules  []string `json:"customRules"`
}

// DefaultRuleSet retourne la config par défaut d'une table.
func DefaultRuleSet() RuleSet {
	return RuleSet{
		DiceCount:    5,
		PacoWild:     true,
		CalzaEnabled: true,
		Palifico:     true,
	}
}

// PalificoTrigger indique si le passage de `before` à `after` dés déclenche
// la manche Palifico pour ce joueur (spec fonc. §1.3).
func PalificoTrigger(before, after int) bool {
	return before > 1 && after == 1
}

// IsEliminated indique si un joueur est éliminé.
func IsEliminated(diceCount int) bool {
	return diceCount <= 0
}
