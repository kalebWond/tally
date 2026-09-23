package main

import (
	"math"
	"math/rand/v2"
	"regexp"
	"slices"
	"testing"
)

var codePattern = regexp.MustCompile(`^[A-Z0-9]{1,16}$`)

func testCodes() []string {
	return []string{"C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"}
}

func compose(t *testing.T, invalid, dup float64, n int) []composed {
	t.Helper()
	rng := rand.New(rand.NewPCG(1, 2))
	race := newRace(len(testCodes()), rng)
	c := newComposer(testCodes(), invalid, dup, race, rng)
	out := make([]composed, n)
	for i := range out {
		out[i] = c.next("0192f3a0-7c1e-7000-8000-00000000c0de")
	}
	return out
}

func share(votes []composed, pred func(composed) bool) float64 {
	k := 0
	for _, v := range votes {
		if pred(v) {
			k++
		}
	}
	return float64(k) / float64(len(votes))
}

func TestInvalidCodeRatioIsHonoured(t *testing.T) {
	for _, ratio := range []float64{0, 0.1, 0.5} {
		got := share(compose(t, ratio, 0, 200_000), func(v composed) bool { return v.invalid })
		if math.Abs(got-ratio) > 0.005 {
			t.Errorf("invalid ratio %.2f: got %.4f", ratio, got)
		}
	}
}

func TestInvalidCodesAreWellFormedButNeverReal(t *testing.T) {
	// Well-formed so ingest accepts them (202) and they reach the consumer's dead letters,
	// rather than bouncing off ingest's validation as a 400.
	for _, v := range compose(t, 0.5, 0, 50_000) {
		real := slices.Contains(testCodes(), v.vote.Code)
		if !codePattern.MatchString(v.vote.Code) {
			t.Fatalf("code %q would be rejected by ingest", v.vote.Code)
		}
		if v.invalid == real {
			t.Fatalf("code %q: invalid=%v but real=%v", v.vote.Code, v.invalid, real)
		}
	}
}

func TestDuplicateSenderRatioIsHonoured(t *testing.T) {
	votes := compose(t, 0, 0.2, 200_000)
	if got := share(votes, func(v composed) bool { return v.duplicate }); math.Abs(got-0.2) > 0.005 {
		t.Fatalf("duplicate ratio 0.2: got %.4f", got)
	}
	seen := map[string]bool{}
	for _, v := range votes {
		if v.duplicate != seen[v.vote.Sender] {
			t.Fatalf("sender %q: duplicate=%v but seen before=%v", v.vote.Sender, v.duplicate, seen[v.vote.Sender])
		}
		seen[v.vote.Sender] = true
	}
}

func TestVotesCarryTheGeneratorSource(t *testing.T) {
	for _, v := range compose(t, 0.1, 0.1, 1000) {
		if v.vote.Source != "generator" || v.vote.ContestID == "" || v.vote.Sender == "" {
			t.Fatalf("incomplete vote: %+v", v.vote)
		}
	}
}

func TestRaceDriftsSoLeadsChangeHands(t *testing.T) {
	rng := rand.New(rand.NewPCG(3, 4))
	race := newRace(10, rng)
	leaders := map[int]bool{}
	for range 300 { // 300 drift steps ≈ 10 minutes at one step per 2 s
		race.drift(rng)
		w := race.snapshot()
		for _, x := range w {
			if x < minWeight || x > maxWeight {
				t.Fatalf("weight %v outside [%v, %v]", x, minWeight, maxWeight)
			}
		}
		leaders[slices.Index(w, slices.Max(w))] = true
	}
	if len(leaders) < 3 {
		t.Fatalf("only %d different leaders over 300 drift steps; the race is static", len(leaders))
	}
}

func TestSamplingFollowsTheWeights(t *testing.T) {
	rng := rand.New(rand.NewPCG(5, 6))
	weights := []float64{1, 3} // second code should get ~75%
	hits := 0
	for range 100_000 {
		if pick(weights, rng) == 1 {
			hits++
		}
	}
	if got := float64(hits) / 100_000; math.Abs(got-0.75) > 0.01 {
		t.Fatalf("weighted pick: %.3f, want ~0.75", got)
	}
}
