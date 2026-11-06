package game

import "fmt"

// CustomRule est une règle maison activable par table (spec fonc. §1.5).
// Chaque règle est un module enregistré via RegisterRule ; les hooks
// optionnels s'implémentent via les interfaces *Hook ci-dessous.
type CustomRule interface {
	// ID stable, utilisé dans RuleSet.CustomRules.
	ID() string
	// Description courte affichée dans les options de table.
	Description() string
	// RankedSafe : true si la règle ne casse pas l'équité (partie éligible aux stats).
	RankedSafe() bool
	// Incompatible retourne la raison d'incompatibilité avec une autre règle
	// ou une option officielle, "" sinon. Appelé pour chaque paire et contre rs.
	Incompatible(rs RuleSet, others []string) string
}

// BidHook permet à une règle de surcharger la validation d'une enchère.
type BidHook interface {
	CheckBid(prev Bid, hasPrev, palifico bool, b Bid) (err error, handled bool)
}

// CountHook permet à une règle de surcharger le décompte des dés.
type CountHook interface {
	Count(dice map[int][]DieValue, b Bid, pacoWild, palifico bool) (n int, handled bool)
}

// ResolveHook permet à une règle d'ajuster une résolution Dudo/Calza.
type ResolveHook interface {
	AdjustResolution(res *Resolution, r *Round)
}

var registry = map[string]func() CustomRule{}

// RegisterRule enregistre une règle personnalisée. Panic sur ID dupliqué
// (erreur de programmation, pas de données).
func RegisterRule(factory func() CustomRule) {
	r := factory()
	if _, exists := registry[r.ID()]; exists {
		panic(fmt.Sprintf("game: règle dupliquée %q", r.ID()))
	}
	registry[r.ID()] = factory
}

// RegisteredRules liste les règles perso disponibles (pour l'UI des options).
func RegisteredRules() []CustomRule {
	out := make([]CustomRule, 0, len(registry))
	for _, f := range registry {
		out = append(out, f())
	}
	return out
}

// resolvedRuleSet est un RuleSet validé avec ses modules de règles résolus.
type resolvedRuleSet struct {
	opts  RuleSet
	rules []CustomRule
	bid   []BidHook
	count []CountHook
	res   []ResolveHook
}

// NewRuleSet valide les options, résout les règles perso et vérifie la
// matrice de compatibilité (spec tech §7). Erreur si invalide.
func NewRuleSet(opts RuleSet) (*resolvedRuleSet, error) {
	if opts.DiceCount < minDice || opts.DiceCount > maxDice {
		return nil, ErrBadDiceCount
	}
	rs := &resolvedRuleSet{opts: opts}
	for _, id := range opts.CustomRules {
		factory, ok := registry[id]
		if !ok {
			return nil, fmt.Errorf("%w : %q", ErrUnknownRule, id)
		}
		rs.rules = append(rs.rules, factory())
	}
	// Compatibilité : chaque règle contre les options + les autres règles.
	ids := make([]string, len(rs.rules))
	for i, r := range rs.rules {
		ids[i] = r.ID()
	}
	for _, r := range rs.rules {
		if why := r.Incompatible(opts, ids); why != "" {
			return nil, fmt.Errorf("%w : %q (%s)", ErrIncompatibleRules, r.ID(), why)
		}
	}
	for _, r := range rs.rules {
		if h, ok := r.(BidHook); ok {
			rs.bid = append(rs.bid, h)
		}
		if h, ok := r.(CountHook); ok {
			rs.count = append(rs.count, h)
		}
		if h, ok := r.(ResolveHook); ok {
			rs.res = append(rs.res, h)
		}
	}
	return rs, nil
}

// Options retourne les options officielles du ruleset.
func (rs *resolvedRuleSet) Options() RuleSet { return rs.opts }

// RankedSafe indique si la table est éligible aux stats (toutes les règles
// perso doivent être ranked-safe ; spec fonc. §1.5).
func (rs *resolvedRuleSet) RankedSafe() bool {
	for _, r := range rs.rules {
		if !r.RankedSafe() {
			return false
		}
	}
	return true
}
