package game

import "testing"

// Double Paco : chaque paco contribuable compte pour 2.
func TestDoublePacoCount(t *testing.T) {
	opts := DefaultRuleSet()
	opts.CustomRules = []string{"double_paco"}
	rs := mustRS(t, opts)
	dice := diceSet() // threes:3, pacos:4

	r := rs.NewRound(dice, false)
	// 3 threes + 4 pacos×2 = 11
	if got := r.CountFor(Bid{1, Three}); got != 11 {
		t.Errorf("wild CountFor={%d} want 11", got)
	}
	// enchère paco : 4 pacos ×2 = 8
	if got := r.CountFor(Bid{1, Paco}); got != 8 {
		t.Errorf("paco CountFor=%d want 8", got)
	}
	// palifico : pacos ne comptent plus comme wild → 3
	r = rs.NewRound(dice, true)
	if got := r.CountFor(Bid{1, Three}); got != 3 {
		t.Errorf("palifico CountFor=%d want 3", got)
	}
}

// Double Paco exige le Paco joker.
func TestDoublePacoIncompatibilite(t *testing.T) {
	opts := DefaultRuleSet()
	opts.PacoWild = false
	opts.CustomRules = []string{"double_paco"}
	if _, err := NewRuleSet(opts); err == nil {
		t.Error("NewRuleSet devrait rejeter double_paco sans PacoWild")
	}
}

// Menteur puni : bluff surestimé de ≥3 → 2 dés perdus.
func TestMenteurPuni(t *testing.T) {
	opts := DefaultRuleSet()
	opts.CustomRules = []string{"menteur_puni"}
	rs := mustRS(t, opts)

	r := rs.NewRound(diceSet(), false)
	bidSeq(t, r, 1, Bid{10, Three}) // matched=7 → écart 3
	res, err := r.CallDudo(0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Loser != 1 || res.DiceLost != 2 {
		t.Errorf("Loser=%d DiceLost=%d want 1/2", res.Loser, res.DiceLost)
	}

	r = rs.NewRound(diceSet(), false)
	bidSeq(t, r, 1, Bid{8, Three}) // matched=7 → écart 1
	res, _ = r.CallDudo(0)
	if res.DiceLost != 1 {
		t.Errorf("écart<3: DiceLost=%d want 1", res.DiceLost)
	}
}

func TestReglesInconnuesEtRanked(t *testing.T) {
	opts := DefaultRuleSet()
	opts.CustomRules = []string{"regle_inexistante"}
	if _, err := NewRuleSet(opts); err == nil {
		t.Error("règle inconnue devrait être rejetée")
	}

	opts = DefaultRuleSet()
	opts.CustomRules = []string{"double_paco"}
	if rs := mustRS(t, opts); !rs.RankedSafe() {
		t.Error("double_paco devrait être ranked-safe")
	}
	opts.CustomRules = []string{"menteur_puni"}
	if rs := mustRS(t, opts); rs.RankedSafe() {
		t.Error("menteur_puni ne devrait pas être ranked-safe")
	}

	if len(RegisteredRules()) < 2 {
		t.Error("registry devrait contenir les 2 règles pilotes")
	}
}
