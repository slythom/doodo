package game

// Règles personnalisées pilotes (spec fonc. §1.5). Chaque règle = un module
// enregistré + hooks optionnels ; la matrice de compatibilité est déclarative.

func init() {
	RegisterRule(func() CustomRule { return doublePaco{} })
	RegisterRule(func() CustomRule { return menteurPuni{} })
}

// doublePaco : « Double Paco » — les Pacos comptent double dans le décompte.
type doublePaco struct{}

func (doublePaco) ID() string          { return "double_paco" }
func (doublePaco) Description() string { return "Les Pacos comptent double" }
func (doublePaco) RankedSafe() bool    { return true }

func (doublePaco) Incompatible(rs RuleSet, _ []string) string {
	if !rs.PacoWild {
		return "nécessite l'option Paco joker"
	}
	return ""
}

// Count compte chaque Paco contribuable pour 2 : en wildcard (enchère
// hors-Paco, Paco joker actif, hors Palifico) ou quand l'enchère est en Pacos.
func (doublePaco) Count(dice map[int][]DieValue, b Bid, pacoWild, palifico bool) (int, bool) {
	n := 0
	for _, ds := range dice {
		for _, d := range ds {
			switch {
			case d == b.Value && d == Paco:
				n += 2
			case d == b.Value:
				n++
			case d == Paco && pacoWild && !palifico && b.Value != Paco:
				n += 2
			}
		}
	}
	return n, true
}

// menteurPuni : « Menteur puni » — un bluff éhonté (enchère surestimée de
// 3 dés ou plus au Dudo) coûte 2 dés à l'enchérisseur au lieu d'1.
type menteurPuni struct{}

func (menteurPuni) ID() string                            { return "menteur_puni" }
func (menteurPuni) Description() string                   { return "Bluff surestimé de 3+ dés : 2 dés perdus" }
func (menteurPuni) RankedSafe() bool                      { return false }
func (menteurPuni) Incompatible(RuleSet, []string) string { return "" }

// AdjustResolution double la perte quand le bluff était surestimé de ≥3 dés.
func (menteurPuni) AdjustResolution(res *Resolution, _ *Round) {
	if res.Loser == res.Bidder && res.Bid.Qty-res.Matched >= 3 {
		res.DiceLost = 2
	}
}
