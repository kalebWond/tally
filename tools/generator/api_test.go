package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func apiServer(t *testing.T) *httptest.Server {
	ingest := newFakeIngest(t)
	e := NewEngine(ingest.srv.URL, 8, slog.New(slog.NewTextHandler(io.Discard, nil)))
	srv := httptest.NewServer(newMux(e))
	t.Cleanup(func() { e.Stop(); srv.Close() })
	return srv
}

func post(t *testing.T, srv *httptest.Server, path, body string) (*http.Response, []byte) {
	t.Helper()
	res, err := http.Post(srv.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

const validStart = `{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":["C1","C2"],"ratePerSec":5}`

func TestStartReturnsTheRunningStatus(t *testing.T) {
	srv := apiServer(t)
	res, body := post(t, srv, "/start", validStart)
	var s Status
	if res.StatusCode != http.StatusOK || json.Unmarshal(body, &s) != nil || !s.Running || s.BaseRate != 5 {
		t.Fatalf("start: %d %s", res.StatusCode, body)
	}
}

func TestStartRejectsBadInputWithFieldLevelIssues(t *testing.T) {
	srv := apiServer(t)
	for name, tc := range map[string]struct{ body, field string }{
		"not a uuid":      {`{"contestId":"x","codes":["C1"],"ratePerSec":5}`, "contestId"},
		"no codes":        {`{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":[],"ratePerSec":5}`, "codes"},
		"lowercase code":  {`{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":["c1"],"ratePerSec":5}`, "codes.0"},
		"rate too high":   {`{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":["C1"],"ratePerSec":20001}`, "ratePerSec"},
		"ratio above one": {`{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":["C1"],"ratePerSec":5,"invalidCodeRatio":1.5}`, "invalidCodeRatio"},
		"negative ratio":  {`{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":["C1"],"ratePerSec":5,"duplicateSenderRatio":-0.1}`, "duplicateSenderRatio"},
		"unknown field":   {`{"contestId":"0192f3a0-7c1e-7000-8000-00000000c0de","codes":["C1"],"ratePerSec":5,"rate":9}`, ""},
		"not json":        {`{`, ""},
	} {
		res, body := post(t, srv, "/start", tc.body)
		var e ErrorResponse
		if res.StatusCode != http.StatusBadRequest || json.Unmarshal(body, &e) != nil || e.Error != "invalid_request" {
			t.Errorf("%s: %d %s", name, res.StatusCode, body)
			continue
		}
		if tc.field != "" && (len(e.Issues) == 0 || e.Issues[0].Path != tc.field) {
			t.Errorf("%s: issues %+v, want path %q", name, e.Issues, tc.field)
		}
	}
}

func TestConflictsAre409(t *testing.T) {
	srv := apiServer(t)
	if res, _ := post(t, srv, "/burst", `{"ratePerSec":100,"durationSec":1}`); res.StatusCode != http.StatusConflict {
		t.Fatalf("burst while stopped: %d, want 409", res.StatusCode)
	}
	if res, _ := post(t, srv, "/rate", `{"ratePerSec":100}`); res.StatusCode != http.StatusConflict {
		t.Fatalf("rate while stopped: %d, want 409", res.StatusCode)
	}
	post(t, srv, "/start", validStart)
	if res, body := post(t, srv, "/rate", `{"ratePerSec":0}`); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("rate 0: %d %s, want 400", res.StatusCode, body)
	}
	if res, body := post(t, srv, "/rate", `{"ratePerSec":250}`); res.StatusCode != http.StatusOK || !strings.Contains(string(body), `"baseRate":250`) {
		t.Fatalf("rate: %d %s", res.StatusCode, body)
	}
	if res, _ := post(t, srv, "/start", validStart); res.StatusCode != http.StatusConflict {
		t.Fatalf("start while running: %d, want 409", res.StatusCode)
	}
}

func TestStopAndStatus(t *testing.T) {
	srv := apiServer(t)
	post(t, srv, "/start", validStart)
	if res, body := post(t, srv, "/stop", ""); res.StatusCode != http.StatusOK || !strings.Contains(string(body), `"running":false`) {
		t.Fatalf("stop: %d %s", res.StatusCode, body)
	}
	res, err := http.Get(srv.URL + "/status")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("status: %v %v", err, res)
	}
}

func TestMetricsExposeTheRunInPrometheusFormat(t *testing.T) {
	srv := apiServer(t)
	post(t, srv, "/start", validStart)
	res, err := http.Get(srv.URL + "/metrics")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("metrics: %v %v", err, res)
	}
	body, _ := io.ReadAll(res.Body)
	for _, want := range []string{
		"# TYPE tally_generator_sent_total counter",
		`tally_generator_running{service="generator"} 1`,
		`tally_generator_target_rate{service="generator"} `,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("metrics missing %q:\n%s", want, body)
		}
	}
}

