package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// newMux serves the control API (SPEC §7): POST /start, /rate, /burst, /stop and GET /status, /health.
// Every control call answers with the resulting Status.
func newMux(e *Engine) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, HealthResponse{Status: "ok", Service: "generator"})
	})

	// Prometheus text format (F23), written by hand to stay standard-library only. The counters
	// cover the current or last run and restart from zero at each /start; Prometheus's rate()
	// treats that as a counter reset.
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		s := e.Status()
		running := 0
		if s.Running {
			running = 1
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		metric := func(name, kind, help string, value any) {
			fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n%s{service=\"generator\"} %v\n", name, help, name, kind, name, value)
		}
		metric("tally_generator_running", "gauge", "1 while a run is in progress", running)
		metric("tally_generator_target_rate", "gauge", "Votes per second asked for right now (burst included)", s.CurrentRate)
		metric("tally_generator_sent_total", "counter", "Votes sent to ingest this run", s.SentTotal)
		metric("tally_generator_accepted_total", "counter", "Votes ingest answered 202 this run", s.Accepted)
		metric("tally_generator_rejected_total", "counter", "Votes ingest answered with another status this run", s.Rejected)
		metric("tally_generator_failed_total", "counter", "Votes that got no answer this run", s.Failed)
	})

	mux.HandleFunc("GET /status", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, e.Status())
	})

	mux.HandleFunc("POST /start", func(w http.ResponseWriter, r *http.Request) {
		var req StartRequest
		if !decode(w, r, &req) {
			return
		}
		if issues := validateStart(req); len(issues) > 0 {
			writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid_request", Issues: issues})
			return
		}
		err := e.Start(RunConfig{
			ContestID: req.ContestID, Codes: req.Codes, RatePerSec: req.RatePerSec,
			InvalidCodeRatio: req.InvalidCodeRatio, DuplicateSenderRatio: req.DuplicateSenderRatio,
		})
		respond(w, e, err)
	})

	mux.HandleFunc("POST /rate", func(w http.ResponseWriter, r *http.Request) {
		var req RateRequest
		if !decode(w, r, &req) {
			return
		}
		if issues := validateRate(req.RatePerSec); len(issues) > 0 {
			writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid_request", Issues: issues})
			return
		}
		respond(w, e, e.SetRate(req.RatePerSec))
	})

	mux.HandleFunc("POST /burst", func(w http.ResponseWriter, r *http.Request) {
		var req BurstRequest
		if !decode(w, r, &req) {
			return
		}
		if issues := validateBurst(req); len(issues) > 0 {
			writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid_request", Issues: issues})
			return
		}
		respond(w, e, e.Burst(req.RatePerSec, req.DurationSec))
	})

	mux.HandleFunc("POST /stop", func(w http.ResponseWriter, _ *http.Request) {
		e.Stop()
		writeJSON(w, http.StatusOK, e.Status())
	})

	return mux
}

func respond(w http.ResponseWriter, e *Engine, err error) {
	switch {
	case errors.Is(err, errAlreadyRunning), errors.Is(err, errNotRunning):
		writeJSON(w, http.StatusConflict, ErrorResponse{Error: "conflict", Issues: []Issue{{Path: "", Message: err.Error()}}})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "internal", Issues: []Issue{}})
	default:
		writeJSON(w, http.StatusOK, e.Status())
	}
}

// decode reads a JSON body strictly (unknown fields are an error), answering 400 itself on failure.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{
			Error: "invalid_request", Issues: []Issue{{Path: "", Message: "body must be a JSON object with only the documented fields"}},
		})
		return false
	}
	return true
}

// Messages describe the rule; like ingest, they never echo the submitted value.
func validateStart(req StartRequest) []Issue {
	var issues []Issue
	if !uuidRe.MatchString(req.ContestID) {
		issues = append(issues, Issue{"contestId", "must be a UUID"})
	}
	if len(req.Codes) == 0 || len(req.Codes) > maxCodes {
		issues = append(issues, Issue{"codes", fmt.Sprintf("must list 1–%d codes", maxCodes)})
	}
	for i, c := range req.Codes {
		if !codeRe.MatchString(c) {
			issues = append(issues, Issue{fmt.Sprintf("codes.%d", i), "must be 1–16 uppercase letters or digits"})
		}
	}
	issues = append(issues, validateRate(req.RatePerSec)...)
	if req.InvalidCodeRatio < 0 || req.InvalidCodeRatio > 1 {
		issues = append(issues, Issue{"invalidCodeRatio", "must be between 0 and 1"})
	}
	if req.DuplicateSenderRatio < 0 || req.DuplicateSenderRatio > 1 {
		issues = append(issues, Issue{"duplicateSenderRatio", "must be between 0 and 1"})
	}
	return issues
}

func validateRate(rate int) []Issue {
	if rate < minRate || rate > maxRate {
		return []Issue{{"ratePerSec", fmt.Sprintf("must be an integer from %d to %d", minRate, maxRate)}}
	}
	return nil
}

func validateBurst(req BurstRequest) []Issue {
	var issues []Issue
	issues = append(issues, validateRate(req.RatePerSec)...)
	if req.DurationSec < minBurstSec || req.DurationSec > maxBurstSec {
		issues = append(issues, Issue{"durationSec", fmt.Sprintf("must be an integer from %d to %d", minBurstSec, maxBurstSec)})
	}
	return issues
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
