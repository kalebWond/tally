package main

import (
	"math"
	"math/rand/v2"
	"strings"
	"sync/atomic"
)

// Popularity bounds for the drifting race: nobody vanishes, nobody runs away with it forever.
const (
	minWeight = 0.05
	maxWeight = 20.0
	// Per-step volatility of the random walk (log scale). At one step per 2 s, leads build and
	// change hands over tens of seconds: visible overtakes without a jittery leaderboard.
	driftSigma = 0.35
)

// race holds each contestant's popularity. Weights random-walk over time so leads build, fade
// and change hands on their own. Read lock-free by the composer; replaced wholesale by drift.
type race struct {
	weights atomic.Pointer[[]float64]
}

func newRace(n int, rng *rand.Rand) *race {
	w := make([]float64, n)
	for i := range w {
		w[i] = 0.5 + rng.Float64()
	}
	r := &race{}
	r.weights.Store(&w)
	return r
}

func (r *race) snapshot() []float64 { return *r.weights.Load() }

// drift applies one multiplicative random-walk step to every weight.
func (r *race) drift(rng *rand.Rand) {
	cur := r.snapshot()
	next := make([]float64, len(cur))
	for i, w := range cur {
		next[i] = min(maxWeight, max(minWeight, w*math.Exp(driftSigma*rng.NormFloat64())))
	}
	r.weights.Store(&next)
}

// pick returns an index with probability proportional to its weight.
func pick(weights []float64, rng *rand.Rand) int {
	total := 0.0
	for _, w := range weights {
		total += w
	}
	x := rng.Float64() * total
	for i, w := range weights {
		if x < w {
			return i
		}
		x -= w
	}
	return len(weights) - 1
}

// composed is one vote plus what kind of synthetic traffic it is, for the status counters.
type composed struct {
	vote      Vote
	invalid   bool
	duplicate bool
}

// composer builds votes. Not safe for concurrent use: the pacer goroutine owns it.
type composer struct {
	codes        []string
	real         map[string]bool
	invalidRatio float64
	dupRatio     float64
	race         *race
	rng          *rand.Rand
	recent       []string // ring of recent senders, the pool duplicates are drawn from
	filled, head int
}

const recentSenders = 1024

func newComposer(codes []string, invalidRatio, dupRatio float64, r *race, rng *rand.Rand) *composer {
	real := make(map[string]bool, len(codes))
	for _, c := range codes {
		real[c] = true
	}
	return &composer{
		codes: codes, real: real, invalidRatio: invalidRatio, dupRatio: dupRatio,
		race: r, rng: rng, recent: make([]string, recentSenders),
	}
}

func (c *composer) next(contestID string) composed {
	out := composed{vote: Vote{ContestID: contestID, Source: voteSource}}

	if c.rng.Float64() < c.invalidRatio {
		out.vote.Code, out.invalid = c.invalidCode(), true
	} else {
		out.vote.Code = c.codes[pick(c.race.snapshot(), c.rng)]
	}

	if c.filled > 0 && c.rng.Float64() < c.dupRatio {
		out.vote.Sender, out.duplicate = c.recent[c.rng.IntN(c.filled)], true
	} else {
		out.vote.Sender = c.newSender()
		c.recent[c.head] = out.vote.Sender
		c.head = (c.head + 1) % recentSenders
		c.filled = min(c.filled+1, recentSenders)
	}
	return out
}

const alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// invalidCode is well-formed (so ingest accepts it and the consumer dead-letters it as
// unknown_code) but never one of the real codes.
func (c *composer) invalidCode() string {
	for {
		var b strings.Builder
		b.WriteByte('X')
		for range 6 {
			b.WriteByte(alnum[c.rng.IntN(len(alnum))])
		}
		if code := b.String(); !c.real[code] {
			return code
		}
	}
}

// newSender is obviously synthetic: it is hashed by ingest anyway, and must never look real.
func (c *composer) newSender() string {
	const hex = "0123456789abcdef"
	b := []byte("sim:0000000000000000")
	for i := 4; i < len(b); i++ {
		b[i] = hex[c.rng.IntN(16)]
	}
	return string(b)
}
