package game

import "errors"

var (
	ErrBidTooLow           = errors.New("enchère insuffisante")
	ErrBidBadValue         = errors.New("valeur de dé invalide")
	ErrBidBadQty           = errors.New("quantité invalide")
	ErrPalificoValueChange = errors.New("manche Palifico : la valeur ne peut pas changer")
	ErrCalzaDisabled       = errors.New("calza désactivé sur cette table")
	ErrNoBid               = errors.New("aucune enchère en cours")
	ErrUnknownRule         = errors.New("règle personnalisée inconnue")
	ErrIncompatibleRules   = errors.New("règles incompatibles entre elles ou avec les options")
	ErrBadDiceCount        = errors.New("nombre de dés de départ invalide (3-5)")
)
