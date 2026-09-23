package main

import (
	"testing"
	"time"
)

func TestPaceReleasesExactlyTheRateEachSecond(t *testing.T) {
	for _, rate := range []int{1, 7, 100, 999, 3000, 20000} {
		var acc int64
		total := 0
		for range 100 { // 100 ticks of 10 ms = 1 s
			var n int
			n, acc = pace(acc, rate, 10*time.Millisecond)
			total += n
		}
		if total != rate {
			t.Errorf("rate %d: released %d in one second", rate, total)
		}
	}
}

func TestPaceCarriesFractionsInsteadOfDroppingThem(t *testing.T) {
	// 7/s at 10 ms ticks is 0.07 per tick: most ticks release nothing, none may be lost.
	var acc int64
	total := 0
	for range 1000 { // 10 s
		var n int
		n, acc = pace(acc, 7, 10*time.Millisecond)
		total += n
	}
	if total != 70 {
		t.Fatalf("released %d over 10 s at 7/s, want 70", total)
	}
}

func TestPaceFollowsARateChangeOnTheNextTick(t *testing.T) {
	var acc int64
	n, acc := pace(acc, 1000, 10*time.Millisecond)
	if n != 10 {
		t.Fatalf("1000/s tick released %d, want 10", n)
	}
	if n, _ = pace(acc, 3000, 10*time.Millisecond); n != 30 {
		t.Fatalf("after switching to 3000/s a tick released %d, want 30", n)
	}
}
