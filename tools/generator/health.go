package main

import (
	"encoding/json"
	"net/http"
)

// HealthResponse mirrors HealthResponse in packages/contracts/src/health.ts.
type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

func newMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(HealthResponse{Status: "ok", Service: "generator"})
	})
	return mux
}
