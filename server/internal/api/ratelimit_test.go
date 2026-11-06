package api

import (
	"testing"
	"time"
)

func TestRateLimiter(t *testing.T) {
	rl := NewRateLimiter(3, 100*time.Millisecond)
	for i := 0; i < 3; i++ {
		if !rl.Allow("1.2.3.4") {
			t.Fatalf("requête %d devrait passer", i)
		}
	}
	if rl.Allow("1.2.3.4") {
		t.Error("4e requête devrait être bloquée")
	}
	if !rl.Allow("5.6.7.8") {
		t.Error("autre IP non limitée")
	}
	time.Sleep(150 * time.Millisecond)
	if !rl.Allow("1.2.3.4") {
		t.Error("fenêtre non réinitialisée")
	}
}
