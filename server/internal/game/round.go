package game

// Round est une manche en cours. Les dés sont injectés par l'appelant
// (l'acteur lance le RNG) — le package reste sans IO.
type Round struct {
	rs       *resolvedRuleSet
	dice     map[int][]DieValue
	palifico bool // cette manche est une manche Palifico
	current  Bid  // enchère courante (valide si hasBid)
	bidder   int  // siège de l'enchérisseur courant
	hasBid   bool
}

// NewRound crée une manche. dice : seat → tirage (déjà mélangé par l'acteur).
// palifico : true si la manche suit le passage d'un joueur à 1 dé.
func (rs *resolvedRuleSet) NewRound(dice map[int][]DieValue, palifico bool) *Round {
	d := make(map[int][]DieValue, len(dice))
	for seat, ds := range dice {
		d[seat] = append([]DieValue(nil), ds...)
	}
	return &Round{rs: rs, dice: d, palifico: palifico}
}

// Palifico indique si la manche est Palifico.
func (r *Round) Palifico() bool { return r.palifico }

// CurrentBid retourne l'enchère courante et son auteur.
func (r *Round) CurrentBid() (Bid, int, bool) { return r.current, r.bidder, r.hasBid }

// Dice expose les dés de seat (copie).
func (r *Round) Dice(seat int) []DieValue {
	return append([]DieValue(nil), r.dice[seat]...)
}

// AllDice expose tous les dés (révélation / god mode).
func (r *Round) AllDice() map[int][]DieValue {
	out := make(map[int][]DieValue, len(r.dice))
	for seat, ds := range r.dice {
		out[seat] = append([]DieValue(nil), ds...)
	}
	return out
}

// TotalDice retourne le nombre total de dés en jeu.
func (r *Round) TotalDice() int {
	n := 0
	for _, ds := range r.dice {
		n += len(ds)
	}
	return n
}

// PlaceBid valide puis enregistre une enchère de seat.
func (r *Round) PlaceBid(seat int, b Bid) error {
	if err := r.checkBid(b); err != nil {
		return err
	}
	r.current, r.bidder, r.hasBid = b, seat, true
	return nil
}

// checkBid applique la chaîne de validation : hooks perso puis règles officielles.
func (r *Round) checkBid(b Bid) error {
	for _, h := range r.rs.bid {
		if err, handled := h.CheckBid(r.current, r.hasBid, r.palifico, b); handled {
			return err
		}
	}
	if b.Value < Paco || b.Value > Six {
		return ErrBidBadValue
	}
	if b.Qty < 1 {
		return ErrBidBadQty
	}
	if !r.hasBid {
		return nil // première enchère libre
	}
	prev := r.current
	// Palifico : la valeur est figée après la première enchère, seule la
	// quantité monte — toute transition (Paco ou autre valeur) est interdite.
	if r.palifico && b.Value != prev.Value {
		return ErrPalificoValueChange
	}
	prevPaco, newPaco := prev.Value == Paco, b.Value == Paco
	switch {
	case prevPaco && !newPaco:
		// Quitter les Pacos : quantité ≥ 2q+1.
		if b.Qty < prev.Qty*2+1 {
			return ErrBidTooLow
		}
	case !prevPaco && newPaco:
		// Passer aux Pacos : quantité ≥ ceil(q/2).
		if b.Qty < (prev.Qty+1)/2 {
			return ErrBidTooLow
		}
	case prevPaco && newPaco:
		if b.Qty <= prev.Qty {
			return ErrBidTooLow
		}
	default:
		// Monter la quantité (valeur libre) ou la valeur à quantité égale.
		// La quantité ne peut jamais baisser.
		if b.Qty < prev.Qty || (b.Qty == prev.Qty && b.Value <= prev.Value) {
			return ErrBidTooLow
		}
	}
	return nil
}

// MinNextBid retourne la plus petite enchère légale (action auto au timeout).
func (r *Round) MinNextBid() Bid {
	if !r.hasBid {
		return Bid{Qty: 1, Value: Paco}
	}
	if r.palifico {
		return Bid{Qty: r.current.Qty + 1, Value: r.current.Value}
	}
	return Bid{Qty: r.current.Qty + 1, Value: r.current.Value}
}

// CountFor compte les dés correspondant à une enchère, hooks perso inclus.
func (r *Round) CountFor(b Bid) int {
	for _, h := range r.rs.count {
		if n, handled := h.Count(r.dice, b, r.rs.opts.PacoWild, r.palifico); handled {
			return n
		}
	}
	return defaultCount(r.dice, b, r.rs.opts.PacoWild, r.palifico)
}

func defaultCount(dice map[int][]DieValue, b Bid, pacoWild, palifico bool) int {
	wild := pacoWild && !palifico && b.Value != Paco
	n := 0
	for _, ds := range dice {
		for _, d := range ds {
			if d == b.Value || (wild && d == Paco) {
				n++
			}
		}
	}
	return n
}

// CallDudo résout un « je doute » de seat contre l'enchère courante.
// Surestimée → l'enchérisseur perd un dé ; juste ou sous-estimée → l'appelant
// en perd un (l'égalité exacte donne tort au douteur — spec fonc. §1.1).
func (r *Round) CallDudo(seat int) (Resolution, error) {
	if !r.hasBid {
		return Resolution{}, ErrNoBid
	}
	matched := r.CountFor(r.current)
	res := Resolution{
		Caller:   seat,
		Bidder:   r.bidder,
		Bid:      r.current,
		Matched:  matched,
		Exact:    matched == r.current.Qty,
		Loser:    -1,
		Gainer:   -1,
		DiceLost: 1,
	}
	if matched < r.current.Qty {
		res.Loser = r.bidder
	} else {
		res.Loser = seat
	}
	for _, h := range r.rs.res {
		h.AdjustResolution(&res, r)
	}
	return res, nil
}

// CallCalza résout un « exact ! » de seat : l'enchère est exactement juste →
// l'appelant regagne un dé (sans dépasser son max ; à max : rien ne se passe),
// sinon il en perd un.
func (r *Round) CallCalza(seat int) (Resolution, error) {
	if !r.hasBid {
		return Resolution{}, ErrNoBid
	}
	if !r.rs.opts.CalzaEnabled {
		return Resolution{}, ErrCalzaDisabled
	}
	matched := r.CountFor(r.current)
	res := Resolution{
		Caller:   seat,
		Bidder:   r.bidder,
		Bid:      r.current,
		Matched:  matched,
		Exact:    matched == r.current.Qty,
		Loser:    -1,
		Gainer:   -1,
		DiceLost: 1,
	}
	if res.Exact {
		// Regagner un dé est impossible si déjà au max (spec fonc. §1.4).
		if len(r.dice[seat]) < r.rs.opts.DiceCount {
			res.Gainer = seat
		}
	} else {
		res.Loser = seat
	}
	for _, h := range r.rs.res {
		h.AdjustResolution(&res, r)
	}
	return res, nil
}
