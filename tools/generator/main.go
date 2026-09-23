// Command generator produces synthetic vote load against the ingest API, controlled over HTTP
// (SPEC §7): POST /start, /burst, /stop; GET /status.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	port := envOr("PORT", "4002")
	ingestURL := os.Getenv("INGEST_URL")
	if u, err := url.Parse(ingestURL); err != nil || u.Scheme == "" || u.Host == "" {
		logger.Error("INGEST_URL must be an absolute URL, e.g. http://localhost:4000")
		os.Exit(1)
	}
	workers, err := strconv.Atoi(envOr("GENERATOR_WORKERS", "256"))
	if err != nil || workers < 1 {
		logger.Error("GENERATOR_WORKERS must be a positive integer")
		os.Exit(1)
	}

	engine := NewEngine(ingestURL, workers, logger)
	srv := &http.Server{Addr: ":" + port, Handler: newMux(engine), ReadHeaderTimeout: 5 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	go func() {
		logger.Info("generator listening", "port", port, "ingest", ingestURL, "workers", workers)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")
	engine.Stop() // no new votes; in-flight requests finish

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown failed", "err", err)
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
