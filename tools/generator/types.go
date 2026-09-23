package main

import "regexp"

// Wire types. Each mirrors a Zod schema in packages/contracts; contract_test.go checks them
// against the JSON Schemas exported from Zod.

// Vote is the body of POST /votes on ingest (contracts: VoteRequest).
type Vote struct {
	ContestID string `json:"contestId"`
	Code      string `json:"code"`
	Sender    string `json:"sender"`
	Source    string `json:"source"`
}

// StartRequest is the body of POST /start (contracts: GeneratorStartRequest).
type StartRequest struct {
	ContestID            string   `json:"contestId"`
	Codes                []string `json:"codes"`
	RatePerSec           int      `json:"ratePerSec"`
	InvalidCodeRatio     float64  `json:"invalidCodeRatio,omitempty"`
	DuplicateSenderRatio float64  `json:"duplicateSenderRatio,omitempty"`
}

// BurstRequest is the body of POST /burst (contracts: GeneratorBurstRequest).
type BurstRequest struct {
	RatePerSec  int `json:"ratePerSec"`
	DurationSec int `json:"durationSec"`
}

// Latency percentiles of ingest responses, in milliseconds.
type Latency struct {
	P50 float64 `json:"p50"`
	P95 float64 `json:"p95"`
	P99 float64 `json:"p99"`
}

// Status is returned by GET /status and every control call (contracts: GeneratorStatus).
type Status struct {
	Running       bool     `json:"running"`
	ContestID     *string  `json:"contestId"`
	BaseRate      int      `json:"baseRate"`
	CurrentRate   int      `json:"currentRate"`
	BurstEndsAt   *int64   `json:"burstEndsAt"`
	StartedAt     *int64   `json:"startedAt"`
	SentTotal     int64    `json:"sentTotal"`
	Accepted      int64    `json:"accepted"`
	Rejected      int64    `json:"rejected"`
	Failed        int64    `json:"failed"`
	InvalidSent   int64    `json:"invalidSent"`
	DuplicateSent int64    `json:"duplicateSent"`
	LatencyMs     *Latency `json:"latencyMs"`
}

// Issue is one problem with a request (contracts: ErrorResponse.issues).
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ErrorResponse is the 4xx body, the same shape ingest uses (contracts: ErrorResponse).
type ErrorResponse struct {
	Error  string  `json:"error"`
	Issues []Issue `json:"issues"`
}

// HealthResponse mirrors contracts' HealthResponse; the generator has no hard dependencies to report.
type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

const voteSource = "generator"

// Validation rules, identical to the Zod contracts (checked by TestValidationBoundsMatchTheContract).
var (
	uuidRe = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)
	codeRe = regexp.MustCompile(`^[A-Z0-9]{1,16}$`)
)

const (
	minRate     = 1
	maxRate     = 20_000
	minBurstSec = 1
	maxBurstSec = 600
	maxCodes    = 500
)
