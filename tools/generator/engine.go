package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	randv2 "math/rand/v2"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

var (
	errAlreadyRunning = errors.New("a run is already in progress; stop it first")
	errNotRunning     = errors.New("no run in progress; start one first")
)

// RunConfig is a validated /start request.
type RunConfig struct {
	ContestID            string
	Codes                []string
	RatePerSec           int
	InvalidCodeRatio     float64
	DuplicateSenderRatio float64
}

const (
	tick         = 10 * time.Millisecond
	driftEvery   = 2 * time.Second
	latencyRing  = 4096
	requestLimit = 8 * time.Second // ingest caps a publish at 5 s; allow for the 503 to arrive
)

// Engine drives one run at a time: a pacer goroutine composes votes at the current rate and a
// fixed pool of workers POSTs them to ingest over a shared keep-alive client.
type Engine struct {
	ingestURL string
	workers   int
	log       *slog.Logger
	client    *http.Client

	mu    sync.Mutex
	run   *run
	stats *stats // current or most recent run; survives Stop so /status can report it
}

type run struct {
	cfg       RunConfig
	baseRate  atomic.Int64
	burstRate atomic.Int64
	burstEnds atomic.Int64 // epoch ms; 0 when no burst
	startedAt int64
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

type stats struct {
	sent, accepted, rejected, failed, invalid, duplicate atomic.Int64

	mu      sync.Mutex
	latency []float64 // ms, ring
	next    int
}

func NewEngine(ingestURL string, workers int, log *slog.Logger) *Engine {
	transport := &http.Transport{
		MaxIdleConns:        workers * 2,
		MaxIdleConnsPerHost: workers * 2,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression:  true,
	}
	return &Engine{
		ingestURL: ingestURL,
		workers:   workers,
		log:       log,
		client:    &http.Client{Transport: transport, Timeout: requestLimit},
		stats:     &stats{},
	}
}

func (e *Engine) Start(cfg RunConfig) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.run != nil {
		return errAlreadyRunning
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &run{cfg: cfg, startedAt: time.Now().UnixMilli(), cancel: cancel}
	r.baseRate.Store(int64(cfg.RatePerSec))
	st := &stats{}
	e.run, e.stats = r, st

	seed := randv2.Uint64()
	rng := randv2.New(randv2.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	contestRace := newRace(len(cfg.Codes), rng)
	comp := newComposer(cfg.Codes, cfg.InvalidCodeRatio, cfg.DuplicateSenderRatio, contestRace, rng)
	jobs := make(chan composed, e.workers*4)

	r.wg.Add(1)
	go func() { // pacer: the only goroutine that touches the composer
		defer r.wg.Done()
		defer close(jobs)
		ticker := time.NewTicker(tick)
		defer ticker.Stop()
		drift := time.NewTicker(driftEvery)
		defer drift.Stop()
		driftRng := randv2.New(randv2.NewPCG(seed+1, seed))
		last := time.Now()
		var acc int64
		for {
			select {
			case <-ctx.Done():
				return
			case <-drift.C:
				contestRace.drift(driftRng)
			case now := <-ticker.C:
				var n int
				n, acc = pace(acc, r.rateAt(now), now.Sub(last))
				last = now
				for range n {
					select {
					case jobs <- comp.next(cfg.ContestID): // blocks when workers can't keep up
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()

	for range e.workers {
		r.wg.Add(1)
		go func() {
			defer r.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case job, ok := <-jobs:
					if !ok {
						return
					}
					e.send(st, job)
				}
			}
		}()
	}
	e.log.Info("run started", "contestId", cfg.ContestID, "rate", cfg.RatePerSec,
		"codes", len(cfg.Codes), "invalidRatio", cfg.InvalidCodeRatio, "duplicateRatio", cfg.DuplicateSenderRatio)
	return nil
}

// send POSTs one vote. Requests already in flight complete even if Stop is called: Stop only
// prevents new ones, so no vote is abandoned half-sent.
func (e *Engine) send(st *stats, job composed) {
	body, _ := json.Marshal(job.vote)
	req, _ := http.NewRequest(http.MethodPost, e.ingestURL+"/votes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", rand.Text())

	st.sent.Add(1)
	if job.invalid {
		st.invalid.Add(1)
	}
	if job.duplicate {
		st.duplicate.Add(1)
	}
	started := time.Now()
	res, err := e.client.Do(req)
	if err != nil {
		st.failed.Add(1)
		return
	}
	_, _ = io.Copy(io.Discard, res.Body) // drain so the connection is reused
	_ = res.Body.Close()
	st.observe(float64(time.Since(started).Microseconds()) / 1000)
	if res.StatusCode == http.StatusAccepted {
		st.accepted.Add(1)
	} else {
		st.rejected.Add(1)
	}
}

// Burst raises the running generator's rate for the given time, then it falls back to the base
// rate by itself.
func (e *Engine) Burst(rate, durationSec int) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.run == nil {
		return errNotRunning
	}
	e.run.burstRate.Store(int64(rate))
	e.run.burstEnds.Store(time.Now().Add(time.Duration(durationSec) * time.Second).UnixMilli())
	e.log.Info("burst", "rate", rate, "durationSec", durationSec)
	return nil
}

// SetRate changes the running generator's base rate, the ramp. Counters carry on; a burst in
// progress keeps priority until it ends, then the new base rate applies.
func (e *Engine) SetRate(rate int) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.run == nil {
		return errNotRunning
	}
	e.run.baseRate.Store(int64(rate))
	e.log.Info("rate", "rate", rate)
	return nil
}

// Stop ends the run and waits until no more requests will be sent. Safe to call when stopped.
func (e *Engine) Stop() {
	e.mu.Lock()
	r := e.run
	e.run = nil
	e.mu.Unlock()
	if r == nil {
		return
	}
	r.cancel()
	r.wg.Wait()
	e.log.Info("run stopped", "sent", e.stats.sent.Load())
}

func (r *run) rateAt(now time.Time) int {
	if now.UnixMilli() < r.burstEnds.Load() {
		return int(r.burstRate.Load())
	}
	return int(r.baseRate.Load())
}

func (e *Engine) Status() Status {
	e.mu.Lock()
	r, st := e.run, e.stats
	e.mu.Unlock()

	s := Status{
		SentTotal:     st.sent.Load(),
		Accepted:      st.accepted.Load(),
		Rejected:      st.rejected.Load(),
		Failed:        st.failed.Load(),
		InvalidSent:   st.invalid.Load(),
		DuplicateSent: st.duplicate.Load(),
		LatencyMs:     st.percentiles(),
	}
	if r != nil {
		now := time.Now()
		s.Running = true
		s.ContestID = &r.cfg.ContestID
		s.BaseRate = int(r.baseRate.Load())
		s.CurrentRate = r.rateAt(now)
		s.StartedAt = &r.startedAt
		if ends := r.burstEnds.Load(); ends > now.UnixMilli() {
			s.BurstEndsAt = &ends
		}
	}
	return s
}

func (st *stats) observe(ms float64) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if len(st.latency) < latencyRing {
		st.latency = append(st.latency, ms)
		return
	}
	st.latency[st.next] = ms
	st.next = (st.next + 1) % latencyRing
}

func (st *stats) percentiles() *Latency {
	st.mu.Lock()
	sorted := slices.Clone(st.latency)
	st.mu.Unlock()
	if len(sorted) == 0 {
		return nil
	}
	slices.Sort(sorted)
	at := func(p float64) float64 { return sorted[min(len(sorted)-1, int(p*float64(len(sorted))))] }
	return &Latency{P50: at(0.50), P95: at(0.95), P99: at(0.99)}
}
