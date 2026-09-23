package main

import "time"

// pace turns a rate and an elapsed interval into a whole number of votes to send now, carrying
// the remainder in acc (units: vote·µs) so fractions are never lost or rounded away. At 7/s on
// 10 ms ticks most ticks send nothing, yet exactly 7 go out each second; at 3,000/s each tick
// sends 30. Integer arithmetic keeps a long run exact.
func pace(acc int64, rate int, elapsed time.Duration) (int, int64) {
	acc += int64(rate) * elapsed.Microseconds()
	n := acc / 1_000_000
	return int(n), acc - n*1_000_000
}
