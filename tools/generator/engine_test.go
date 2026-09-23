package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeIngest stands in for ingest: counts requests, checks every body decodes as a vote, and
// answers with the configured status.
type fakeIngest struct {
	srv      *httptest.Server
	requests atomic.Int64
	bad      atomic.Int64
	status   atomic.Int32
	mu       sync.Mutex
	keys     map[string]bool
}

func newFakeIngest(t *testing.T) *fakeIngest {
	f := &fakeIngest{keys: map[string]bool{}}
	f.status.Store(http.StatusAccepted)
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests.Add(1)
		body, _ := io.ReadAll(r.Body)
		var v Vote
		if r.URL.Path != "/votes" || json.Unmarshal(body, &v) != nil || v.Code == "" || v.Sender == "" {
			f.bad.Add(1)
		}
		f.mu.Lock()
		f.keys[r.Header.Get("Idempotency-Key")] = true
		f.mu.Unlock()
		w.WriteHeader(int(f.status.Load()))
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func newTestEngine(url string) *Engine {
	return NewEngine(url, 64, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func startRun(t *testing.T, e *Engine, rate int) {
	t.Helper()
	err := e.Start(RunConfig{
		ContestID:  "0192f3a0-7c1e-7000-8000-00000000c0de",
		Codes:      testCodes(),
		RatePerSec: rate,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func near(got, want int64, tolerance float64) bool {
	return float64(got) >= float64(want)*(1-tolerance) && float64(got) <= float64(want)*(1+tolerance)
}

func TestEngineSendsAtTheRequestedRate(t *testing.T) {
	ingest := newFakeIngest(t)
	e := newTestEngine(ingest.srv.URL)
	startRun(t, e, 1000)
	time.Sleep(2 * time.Second)
	e.Stop()

	if got := ingest.requests.Load(); !near(got, 2000, 0.05) {
		t.Fatalf("sent %d in 2 s at 1000/s", got)
	}
	if ingest.bad.Load() != 0 {
		t.Fatalf("%d malformed requests", ingest.bad.Load())
	}
	s := e.Status()
	if s.SentTotal != ingest.requests.Load() || s.Accepted != s.SentTotal || s.Rejected != 0 || s.Failed != 0 {
		t.Fatalf("status counters disagree with ingest: %+v (ingest saw %d)", s, ingest.requests.Load())
	}
	if s.LatencyMs == nil || s.LatencyMs.P95 <= 0 {
		t.Fatalf("latency not recorded: %+v", s.LatencyMs)
	}
}

func TestEveryVoteHasItsOwnIdempotencyKey(t *testing.T) {
	ingest := newFakeIngest(t)
	e := newTestEngine(ingest.srv.URL)
	startRun(t, e, 500)
	time.Sleep(time.Second)
	e.Stop()
	ingest.mu.Lock()
	defer ingest.mu.Unlock()
	if int64(len(ingest.keys)) != ingest.requests.Load() || ingest.keys[""] {
		t.Fatalf("%d distinct keys for %d requests", len(ingest.keys), ingest.requests.Load())
	}
}

func TestBurstRaisesTheRateThenFallsBack(t *testing.T) {
	ingest := newFakeIngest(t)
	e := newTestEngine(ingest.srv.URL)
	startRun(t, e, 200)
	if err := e.Burst(2000, 1); err != nil {
		t.Fatal(err)
	}
	if s := e.Status(); s.CurrentRate != 2000 || s.BaseRate != 200 || s.BurstEndsAt == nil {
		t.Fatalf("during burst: %+v", s)
	}
	time.Sleep(1100 * time.Millisecond)
	during := ingest.requests.Load()
	time.Sleep(time.Second)
	after := ingest.requests.Load() - during
	e.Stop()

	if !near(during, 2000, 0.1) {
		t.Fatalf("burst second sent %d, want ~2000", during)
	}
	if !near(after, 200, 0.15) {
		t.Fatalf("second after the burst sent %d, want ~200 (back to base)", after)
	}
	if s := e.Status(); s.BurstEndsAt != nil {
		t.Fatalf("burst still reported after it ended: %+v", s)
	}
}

func TestStopHaltsSending(t *testing.T) {
	ingest := newFakeIngest(t)
	e := newTestEngine(ingest.srv.URL)
	startRun(t, e, 1000)
	time.Sleep(300 * time.Millisecond)
	e.Stop()
	stopped := ingest.requests.Load()
	time.Sleep(300 * time.Millisecond)
	if ingest.requests.Load() != stopped {
		t.Fatalf("still sending after Stop: %d → %d", stopped, ingest.requests.Load())
	}
	if s := e.Status(); s.Running || s.CurrentRate != 0 {
		t.Fatalf("status after stop: %+v", s)
	}
}

func TestNon202AnswersAreCountedAsRejected(t *testing.T) {
	ingest := newFakeIngest(t)
	ingest.status.Store(http.StatusServiceUnavailable)
	e := newTestEngine(ingest.srv.URL)
	startRun(t, e, 200)
	time.Sleep(500 * time.Millisecond)
	e.Stop()
	if s := e.Status(); s.Rejected == 0 || s.Accepted != 0 || s.Rejected != s.SentTotal {
		t.Fatalf("503s not counted as rejected: %+v", s)
	}
}

func TestStartWhileRunningAndBurstWhileStoppedAreRefused(t *testing.T) {
	ingest := newFakeIngest(t)
	e := newTestEngine(ingest.srv.URL)
	if err := e.Burst(1000, 1); err != errNotRunning {
		t.Fatalf("burst while stopped: %v, want errNotRunning", err)
	}
	startRun(t, e, 10)
	defer e.Stop()
	if err := e.Start(RunConfig{ContestID: "0192f3a0-7c1e-7000-8000-00000000c0de", Codes: testCodes(), RatePerSec: 10}); err != errAlreadyRunning {
		t.Fatalf("second start: %v, want errAlreadyRunning", err)
	}
}
