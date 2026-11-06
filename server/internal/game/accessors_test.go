package game

import "testing"

func TestAccessors(t *testing.T) {
	rs := mustRS(t, DefaultRuleSet())
	dice := diceSet()
	r := rs.NewRound(dice, true)

	if !r.Palifico() {
		t.Error("Palifico() devrait être true")
	}
	if r.TotalDice() != 15 {
		t.Errorf("TotalDice=%d want 15", r.TotalDice())
	}
	if got := r.Dice(0); len(got) != 5 || got[0] != Three {
		t.Errorf("Dice(0)=%v", got)
	}
	// copie défensive : muter le retour ne doit pas affecter la manche
	got := r.Dice(0)
	got[0] = Six
	if r.Dice(0)[0] != Three {
		t.Error("Dice() ne retourne pas une copie")
	}
	if all := r.AllDice(); len(all) != 3 || len(all[2]) != 5 {
		t.Errorf("AllDice()=%v", all)
	}
	if opts := rs.Options(); opts.DiceCount != 5 || !opts.PacoWild {
		t.Errorf("Options()=%+v", opts)
	}

	bidSeq(t, r, 2, Bid{3, Four})
	b, bidder, ok := r.CurrentBid()
	if !ok || bidder != 2 || b.Qty != 3 {
		t.Errorf("CurrentBid=%v,%d,%v", b, bidder, ok)
	}
	if mb := r.MinNextBid(); mb != (Bid{4, Four}) {
		t.Errorf("MinNextBid palifico=%v", mb)
	}
}

func TestRegisteredRulesDescriptions(t *testing.T) {
	for _, rule := range RegisteredRules() {
		if rule.ID() == "" || rule.Description() == "" {
			t.Errorf("règle %T : ID/Description vide", rule)
		}
	}
}

func TestCalzaSansEnchere(t *testing.T) {
	r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
	if _, err := r.CallCalza(0); err != ErrNoBid {
		t.Errorf("err=%v want ErrNoBid", err)
	}
}
