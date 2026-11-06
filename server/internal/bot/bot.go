// Package bot implémente les bots : raisonnement probabiliste sur les enchères
// (spec tech §7). Un bot reçoit les mêmes infos qu'un joueur humain —
// jamais les dés adverses.
package bot

import (
	"math"
	"math/rand/v2"

	"doodo/server/internal/game"
)

// Decision est le choix d'un bot pour son tour.
type Decision struct {
	Kind string   // "bid" | "dudo" | "calza"
	Bid  game.Bid // si Kind == "bid"
}

// Decide choisit l'action du bot.
//   - myDice : ses dés
//   - others : nb total de dés adverses
//   - current/hasBid : enchère courante
//   - pacoWild/palifico/calza : options de la table
//   - maxDice : dés de départ (borne du regagner via Calza)
//   - myDiceCount : ses dés restants (pour jauger l'intérêt d'un Calza)
//   - rng : source aléatoire (jitter/bluff)
func Decide(myDice []game.DieValue, others int, current game.Bid, hasBid bool,
	pacoWild, palifico, calzaEnabled bool, myDiceCount, maxDice int,
	rng *rand.Rand) Decision {

	if !hasBid {
		return openBid(myDice, others, pacoWild, palifico, rng)
	}

	p := matchProb(current, pacoWild, palifico)
	own := ownMatches(myDice, current, pacoWild, palifico)
	pTrue := probAtLeast(others, p, current.Qty-own)

	// Dudo : l'enchère est très improbable.
	if pTrue < 0.15 {
		return Decision{Kind: "dudo"}
	}

	// Calza : l'enchère est très probablement exacte et on a perdu des dés.
	if calzaEnabled && myDiceCount < maxDice {
		pExact := probExact(others, p, current.Qty-own)
		if pExact > 0.35 && rng.Float64() < 0.6 {
			return Decision{Kind: "calza"}
		}
	}

	// Sinon surenchérir. Si même la plus petite enchère est douteuse,
	// Dudo quand la confiance est moyenne (risque/bénéfice).
	next := raiseBid(myDice, others, current, pacoWild, palifico, rng)
	ownNext := ownMatches(myDice, next, pacoWild, palifico)
	pNext := probAtLeast(others, matchProb(next, pacoWild, palifico), next.Qty-ownNext)
	if pNext < 0.30 && pTrue < 0.55 {
		return Decision{Kind: "dudo"}
	}
	return Decision{Kind: "bid", Bid: next}
}

// matchProb : probabilité qu'un dé inconnu corresponde à l'enchère.
func matchProb(b game.Bid, pacoWild, palifico bool) float64 {
	if b.Value == game.Paco || !pacoWild || palifico {
		return 1.0 / 6.0
	}
	return 2.0 / 6.0 // valeur ou paco
}

// ownMatches : dés propres correspondant à l'enchère.
func ownMatches(myDice []game.DieValue, b game.Bid, pacoWild, palifico bool) int {
	wild := pacoWild && !palifico && b.Value != game.Paco
	n := 0
	for _, d := range myDice {
		if d == b.Value || (wild && d == game.Paco) {
			n++
		}
	}
	return n
}

// openBid : enchère d'ouverture — compte attendu + légère agressivité aléatoire.
func openBid(myDice []game.DieValue, others int, pacoWild, palifico bool, rng *rand.Rand) Decision {
	// Meilleure valeur propre (hors paco de préférence).
	bestVal, bestN := bestFace(myDice, pacoWild, palifico)
	p := matchProb(game.Bid{Value: bestVal}, pacoWild, palifico)
	expected := bestN + int(math.Round(float64(others)*p))
	qty := expected + rng.IntN(2) // petit bluff 0/+1
	if qty < 1 {
		qty = 1
	}
	return Decision{Kind: "bid", Bid: game.Bid{Qty: qty, Value: bestVal}}
}

// raiseBid : surenchère minimale orientée vers sa meilleure face quand utile.
func raiseBid(myDice []game.DieValue, others int, current game.Bid,
	pacoWild, palifico bool, rng *rand.Rand) game.Bid {
	if palifico {
		return game.Bid{Qty: current.Qty + 1, Value: current.Value}
	}
	// Option A : quantité+1 sur sa meilleure face si elle est favorable.
	bestVal, _ := bestFace(myDice, pacoWild, palifico)
	if bestVal != current.Value && bestVal != game.Paco && rng.Float64() < 0.4 {
		return game.Bid{Qty: current.Qty + 1, Value: bestVal}
	}
	// Option B : quantité+1 même valeur.
	return game.Bid{Qty: current.Qty + 1, Value: current.Value}
}

// bestFace retourne la valeur la plus représentée parmi ses dés
// (pacos inclus comme wild si actif ; jamais paco comme valeur choisie).
func bestFace(myDice []game.DieValue, pacoWild, palifico bool) (game.DieValue, int) {
	counts := [7]int{}
	pacos := 0
	for _, d := range myDice {
		if d == game.Paco {
			pacos++
		} else {
			counts[d]++
		}
	}
	best, n := game.DieValue(6), -1
	for v := game.DieValue(2); v <= 6; v++ {
		c := counts[v]
		if pacoWild && !palifico {
			c += pacos
		}
		if c >= n {
			best, n = v, c
		}
	}
	if n <= 0 && pacos > 0 {
		return game.Paco, pacos
	}
	return best, n
}

// probAtLeast : P(X ≥ k) pour X~Binom(n,p) — k≤0 → 1.
func probAtLeast(n int, p float64, k int) float64 {
	if k <= 0 {
		return 1
	}
	if k > n {
		return 0
	}
	return 1 - binomCDF(n, p, k-1)
}

// probExact : P(X = k).
func probExact(n int, p float64, k int) float64 {
	if k < 0 || k > n {
		return 0
	}
	return binomPMF(n, p, k)
}

func binomPMF(n int, p float64, k int) float64 {
	return comb(n, k) * math.Pow(p, float64(k)) * math.Pow(1-p, float64(n-k))
}

func binomCDF(n int, p float64, k int) float64 {
	if k < 0 {
		return 0
	}
	sum := 0.0
	for i := 0; i <= k; i++ {
		sum += binomPMF(n, p, i)
	}
	return sum
}

func comb(n, k int) float64 {
	if k < 0 || k > n {
		return 0
	}
	if k > n-k {
		k = n - k
	}
	c := 1.0
	for i := 0; i < k; i++ {
		c = c * float64(n-i) / float64(i+1)
	}
	return c
}
