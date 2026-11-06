package game

import (
	"testing"
	"testing/quick"
)

func mustRS(t *testing.T, opts RuleSet) *Rules {
	t.Helper()
	rs, err := NewRuleSet(opts)
	if err != nil {
		t.Fatalf("NewRuleSet: %v", err)
	}
	return rs
}

func diceSet() map[int][]DieValue {
	return map[int][]DieValue{
		0: {Three, Five, Paco, Six, Two},
		1: {Three, Three, Paco, Two, Four},
		2: {Six, Six, Paco, Paco, Five},
	}
}

func bidSeq(t *testing.T, r *Round, seat int, bids ...Bid) {
	t.Helper()
	for _, b := range bids {
		if err := r.PlaceBid(seat, b); err != nil {
			t.Fatalf("PlaceBid(%v): %v", b, err)
		}
	}
}

// ─── Validation des enchères ─────────────────────────────────────────

func TestFirstBid(t *testing.T) {
	r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
	for _, tc := range []struct {
		bid   Bid
		valid bool
	}{
		{Bid{1, Paco}, true},
		{Bid{3, Six}, true},
		{Bid{0, Three}, false},
		{Bid{-2, Three}, false},
		{Bid{2, 7}, false},
		{Bid{2, 0}, false},
	} {
		err := r.PlaceBid(0, tc.bid)
		if tc.valid && err != nil {
			t.Errorf("bid %v devrait être valide: %v", tc.bid, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("bid %v devrait être rejetée", tc.bid)
		}
		// reset entre chaque cas
		r = mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
	}
}

func TestBidProgression(t *testing.T) {
	for _, tc := range []struct {
		name  string
		prev  Bid
		next  Bid
		valid bool
	}{
		{"qty up même valeur", Bid{3, Four}, Bid{4, Four}, true},
		{"qty up valeur inf", Bid{3, Four}, Bid{4, Two}, true},
		{"même qty valeur up", Bid{3, Four}, Bid{3, Five}, true},
		{"même qty même valeur", Bid{3, Four}, Bid{3, Four}, false},
		{"qty down", Bid{3, Four}, Bid{2, Six}, false},
		{"même qty valeur down", Bid{3, Four}, Bid{3, Two}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
			bidSeq(t, r, 0, tc.prev)
			err := r.PlaceBid(1, tc.next)
			if tc.valid != (err == nil) {
				t.Errorf("après %v, bid %v valid=%v err=%v", tc.prev, tc.next, tc.valid, err)
			}
		})
	}
}

func TestPacoTransitions(t *testing.T) {
	for _, tc := range []struct {
		name  string
		prev  Bid
		next  Bid
		valid bool
	}{
		{"vers paco ceil(4/2)=2", Bid{4, Four}, Bid{2, Paco}, true},
		{"vers paco qty sup", Bid{4, Four}, Bid{3, Paco}, true},
		{"vers paco trop bas", Bid{4, Four}, Bid{1, Paco}, false},
		{"vers paco ceil(3/2)=2", Bid{3, Five}, Bid{2, Paco}, true},
		{"vers paco 3→1 ko", Bid{3, Five}, Bid{1, Paco}, false},
		{"paco→paco qty up", Bid{2, Paco}, Bid{3, Paco}, true},
		{"paco→paco même qty", Bid{2, Paco}, Bid{2, Paco}, false},
		{"quitte paco 2*2+1=5", Bid{2, Paco}, Bid{5, Three}, true},
		{"quitte paco trop bas", Bid{2, Paco}, Bid{4, Three}, false},
		{"quitte paco qty haute", Bid{2, Paco}, Bid{9, Six}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
			bidSeq(t, r, 0, tc.prev)
			err := r.PlaceBid(1, tc.next)
			if tc.valid != (err == nil) {
				t.Errorf("après %v, bid %v valid=%v err=%v", tc.prev, tc.next, tc.valid, err)
			}
		})
	}
}

func TestPalificoLocksValue(t *testing.T) {
	r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), true)
	bidSeq(t, r, 0, Bid{2, Three})
	for _, tc := range []struct {
		bid   Bid
		valid bool
	}{
		{Bid{3, Three}, true},
		{Bid{3, Four}, false}, // changement de valeur interdit
		{Bid{4, Paco}, false}, // transition paco interdite
		{Bid{2, Three}, false},
	} {
		err := r.PlaceBid(1, tc.bid)
		if tc.valid != (err == nil) {
			t.Errorf("palifico après {2,3}: bid %v valid=%v err=%v", tc.bid, tc.valid, err)
		}
	}
}

// ─── Décompte et résolutions ─────────────────────────────────────────

func TestCountFor(t *testing.T) {
	dice := diceSet() // threes: 3, pacos: 4, sixes: 3, twos: 2, fours:1, fives:2
	for _, tc := range []struct {
		name     string
		opts     RuleSet
		palifico bool
		bid      Bid
		want     int
	}{
		{"wild compte pacos", DefaultRuleSet(), false, Bid{1, Three}, 7},
		{"enchère paco", DefaultRuleSet(), false, Bid{1, Paco}, 4},
		{"sans wild", RuleSet{DiceCount: 5, PacoWild: false}, false, Bid{1, Three}, 3},
		{"palifico désactive wild", DefaultRuleSet(), true, Bid{1, Three}, 3},
		{"palifico enchère paco", DefaultRuleSet(), true, Bid{1, Paco}, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := mustRS(t, tc.opts).NewRound(dice, tc.palifico)
			if got := r.CountFor(tc.bid); got != tc.want {
				t.Errorf("CountFor(%v) = %d, want %d", tc.bid, got, tc.want)
			}
		})
	}
}

func TestDudo(t *testing.T) {
	rs := mustRS(t, DefaultRuleSet())
	for _, tc := range []struct {
		name      string
		bid       Bid
		wantLoser int // 0=appelant, 1=enchérisseur
	}{
		{"surestimée → enchérisseur perd", Bid{8, Three}, 1},
		{"exacte → appelant perd", Bid{7, Three}, 0},
		{"sous-estimée → appelant perd", Bid{4, Three}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := rs.NewRound(diceSet(), false)
			bidSeq(t, r, 1, tc.bid)
			res, err := r.CallDudo(0)
			if err != nil {
				t.Fatal(err)
			}
			if res.Loser != tc.wantLoser {
				t.Errorf("bid %v: Loser=%d want %d (matched=%d)", tc.bid, res.Loser, tc.wantLoser, res.Matched)
			}
			if res.DiceLost != 1 {
				t.Errorf("DiceLost=%d want 1", res.DiceLost)
			}
		})
	}
}

func TestDudoSansEnchere(t *testing.T) {
	r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
	if _, err := r.CallDudo(0); err != ErrNoBid {
		t.Errorf("err=%v want ErrNoBid", err)
	}
}

func TestCalza(t *testing.T) {
	rs := mustRS(t, DefaultRuleSet())
	for _, tc := range []struct {
		name       string
		bid        Bid
		callerDice int // dés actuels de l'appelant (0 = seat 0 normal)
		wantGainer int
		wantLoser  int
	}{
		{"exact → regagne 1 dé", Bid{7, Three}, 4, 0, -1},
		{"faux → appelant perd", Bid{5, Three}, 0, -1, 0},
		{"exact à dé max → rien", Bid{7, Three}, 5, -1, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dice := diceSet()
			if tc.callerDice > 0 {
				dice[0] = dice[0][:tc.callerDice]
			}
			r := rs.NewRound(dice, false)
			bidSeq(t, r, 1, tc.bid)
			res, err := r.CallCalza(0)
			if err != nil {
				t.Fatal(err)
			}
			if res.Gainer != tc.wantGainer || res.Loser != tc.wantLoser {
				t.Errorf("Gainer=%d Loser=%d, want %d/%d", res.Gainer, res.Loser, tc.wantGainer, tc.wantLoser)
			}
		})
	}
}

func TestCalzaDesactive(t *testing.T) {
	opts := DefaultRuleSet()
	opts.CalzaEnabled = false
	r := mustRS(t, opts).NewRound(diceSet(), false)
	bidSeq(t, r, 1, Bid{3, Three})
	if _, err := r.CallCalza(0); err != ErrCalzaDisabled {
		t.Errorf("err=%v want ErrCalzaDisabled", err)
	}
}

// ─── Helpers et options ──────────────────────────────────────────────

func TestMinNextBid(t *testing.T) {
	r := mustRS(t, DefaultRuleSet()).NewRound(diceSet(), false)
	if b := r.MinNextBid(); b != (Bid{1, Paco}) {
		t.Errorf("MinNextBid sans enchère = %v", b)
	}
	bidSeq(t, r, 0, Bid{4, Three})
	if b := r.MinNextBid(); b != (Bid{5, Three}) {
		t.Errorf("MinNextBid = %v want {5 3}", b)
	}
}

func TestPalificoTriggerEtElimination(t *testing.T) {
	for _, tc := range []struct {
		before, after int
		want          bool
	}{
		{5, 1, true}, {2, 1, true}, {1, 1, false}, {3, 2, false}, {1, 0, false},
	} {
		if got := PalificoTrigger(tc.before, tc.after); got != tc.want {
			t.Errorf("PalificoTrigger(%d,%d)=%v want %v", tc.before, tc.after, got, tc.want)
		}
	}
	if !IsEliminated(0) || IsEliminated(1) {
		t.Error("IsEliminated incorrect")
	}
}

func TestDiceCountBounds(t *testing.T) {
	for _, n := range []int{2, 6, 0, -1} {
		opts := DefaultRuleSet()
		opts.DiceCount = n
		if _, err := NewRuleSet(opts); err != ErrBadDiceCount {
			t.Errorf("DiceCount=%d err=%v want ErrBadDiceCount", n, err)
		}
	}
}

// ─── Propriétés ──────────────────────────────────────────────────────

// Quitter les Pacos exige toujours 2q+1 minimum.
func TestPropQuittePaco(t *testing.T) {
	rs := mustRS(t, DefaultRuleSet())
	f := func(q uint8, v uint8, nq uint8) bool {
		qty, nqty := int(q%10)+1, int(nq%30)+1
		val := DieValue(v%5) + 2 // 2..6 (pas Paco)
		r := rs.NewRound(diceSet(), false)
		_ = r.PlaceBid(0, Bid{qty, Paco})
		err := r.PlaceBid(1, Bid{nqty, val})
		return (err == nil) == (nqty >= qty*2+1)
	}
	if err := quick.Check(f, &quick.Config{MaxCount: 500}); err != nil {
		t.Error(err)
	}
}

// Hors Palifico et hors transition Paco : qty supérieure est toujours valide.
func TestPropQtyUpToujoursValide(t *testing.T) {
	rs := mustRS(t, DefaultRuleSet())
	f := func(q, v, nq, nv uint8) bool {
		prev := Bid{int(q%20) + 1, DieValue(v%6) + 1}
		next := Bid{prev.Qty + 1 + int(nq%10), DieValue(nv%6) + 1}
		r := rs.NewRound(diceSet(), false)
		_ = r.PlaceBid(0, prev)
		if prev.Value == Paco && next.Value != Paco {
			return true // transition paco : règle différente, hors scope
		}
		return r.PlaceBid(1, next) == nil
	}
	if err := quick.Check(f, &quick.Config{MaxCount: 500}); err != nil {
		t.Error(err)
	}
}
