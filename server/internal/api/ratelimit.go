package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// RateLimiter : token bucket par clé (IP), fenêtre glissante simple.
type RateLimiter struct {
	mu      sync.Mutex
	quota   int
	window  time.Duration
	buckets map[string]*bucket
}

type bucket struct {
	count int
	reset time.Time
}

func NewRateLimiter(quota int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{quota: quota, window: window, buckets: map[string]*bucket{}}
	go rl.cleanup()
	return rl
}

// Allow consomme un jeton pour key ; false si quota dépassé.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b := rl.buckets[key]
	if b == nil || now.After(b.reset) {
		rl.buckets[key] = &bucket{count: 1, reset: now.Add(rl.window)}
		return true
	}
	b.count++
	return b.count <= rl.quota
}

func (rl *RateLimiter) cleanup() {
	for range time.Tick(5 * time.Minute) {
		rl.mu.Lock()
		for k, b := range rl.buckets {
			if time.Now().After(b.reset) {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

// Limit middleware : 429 si le quota par IP est dépassé.
func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !rl.Allow(ip) {
			http.Error(w, `{"code":"rate_limited"}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
