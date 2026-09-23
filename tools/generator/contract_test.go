package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// The Go structs must match the Zod contracts in packages/contracts. They are compared against
// the JSON Schemas exported from Zod (packages/contracts/schemas), which a TS test keeps in
// sync with the Zod source. Regenerate: pnpm --filter @tally/contracts export-schemas.

type jsonSchema struct {
	Type       any                    `json:"type"`
	Properties map[string]*jsonSchema `json:"properties"`
	Required   []string               `json:"required"`
	Items      *jsonSchema            `json:"items"`
	Enum       []any                  `json:"enum"`
	Const      any                    `json:"const"`
	AnyOf      []*jsonSchema          `json:"anyOf"`
	Pattern    string                 `json:"pattern"`
	Minimum    *float64               `json:"minimum"`
	Maximum    *float64               `json:"maximum"`
}

func loadSchema(t *testing.T, name string) *jsonSchema {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "packages", "contracts", "schemas", name+".schema.json"))
	if err != nil {
		t.Fatalf("read schema %s: %v (run from the repo, see scripts/go.sh)", name, err)
	}
	var s jsonSchema
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	return &s
}

// jsonFields maps each JSON field name of a struct to whether it is omitted when empty.
func jsonFields(typ reflect.Type) map[string]reflect.StructField {
	out := map[string]reflect.StructField{}
	for i := range typ.NumField() {
		f := typ.Field(i)
		name := strings.Split(f.Tag.Get("json"), ",")[0]
		if name != "" && name != "-" {
			out[name] = f
		}
	}
	return out
}

func omitEmpty(f reflect.StructField) bool { return strings.Contains(f.Tag.Get("json"), "omitempty") }

// types a schema node allows, flattening nullable anyOf.
func allowed(s *jsonSchema) []string {
	var out []string
	switch v := s.Type.(type) {
	case string:
		out = append(out, v)
	case []any:
		for _, x := range v {
			out = append(out, x.(string))
		}
	}
	for _, alt := range s.AnyOf {
		out = append(out, allowed(alt)...)
	}
	if s.Const != nil && len(out) == 0 {
		out = append(out, "string")
	}
	return out
}

func goJSONType(t reflect.Type) (string, bool) {
	nullable := t.Kind() == reflect.Pointer
	if nullable {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.String:
		return "string", nullable
	case reflect.Bool:
		return "boolean", nullable
	case reflect.Int, reflect.Int64, reflect.Int32:
		return "integer", nullable
	case reflect.Float64:
		return "number", nullable
	case reflect.Slice:
		return "array", nullable
	case reflect.Struct:
		return "object", nullable
	}
	return t.Kind().String(), nullable
}

// assertMatches checks field names, types, nullability and (for outputs) that every field is
// always present. With partial, the Go type may leave out optional properties it never uses
// (e.g. the dependency fields of HealthResponse), but never a required one.
func assertMatches(t *testing.T, name string, typ reflect.Type, output bool, partial ...bool) {
	t.Helper()
	schema := loadSchema(t, name)
	fields := jsonFields(typ)

	for prop, ps := range schema.Properties {
		f, ok := fields[prop]
		if !ok {
			if len(partial) == 0 || slices.Contains(schema.Required, prop) {
				t.Errorf("%s: Go %s has no field for %q", name, typ.Name(), prop)
			}
			continue
		}
		want := allowed(ps)
		got, nullable := goJSONType(f.Type)
		if want != nil && !slices.Contains(want, got) && !(got == "integer" && slices.Contains(want, "number")) {
			t.Errorf("%s.%s: Go type %s, schema allows %v", name, prop, got, want)
		}
		if nullable != slices.Contains(want, "null") && output {
			t.Errorf("%s.%s: Go nullable=%v, schema nullable=%v", name, prop, nullable, slices.Contains(want, "null"))
		}
		if output && omitEmpty(f) {
			t.Errorf("%s.%s: response field must always be present, drop omitempty", name, prop)
		}
		if got == "object" && ps.Properties != nil {
			inner := f.Type
			if inner.Kind() == reflect.Pointer {
				inner = inner.Elem()
			}
			for sub := range ps.Properties {
				if _, ok := jsonFields(inner)[sub]; !ok {
					t.Errorf("%s.%s: Go %s has no field for %q", name, prop, inner.Name(), sub)
				}
			}
		}
	}
	for prop := range fields {
		if _, ok := schema.Properties[prop]; !ok {
			t.Errorf("%s: Go field %q is not in the contract", name, prop)
		}
	}
	for _, req := range schema.Required {
		if f, ok := fields[req]; ok && omitEmpty(f) && !output {
			t.Errorf("%s.%s: required by the contract, must not be omitempty", name, req)
		}
	}
}

func TestVoteMatchesVoteRequestContract(t *testing.T) {
	assertMatches(t, "vote-request", reflect.TypeFor[Vote](), false)
	schema := loadSchema(t, "vote-request")
	if !slices.Contains(schema.Properties["source"].Enum, any(voteSource)) {
		t.Errorf("source %q is not one of %v", voteSource, schema.Properties["source"].Enum)
	}
	if got := schema.Properties["code"].Pattern; got != codeRe.String() {
		t.Errorf("code pattern: contract %q, generator %q", got, codeRe.String())
	}
}

func TestControlAPIMatchesGeneratorContracts(t *testing.T) {
	assertMatches(t, "generator-start-request", reflect.TypeFor[StartRequest](), false)
	assertMatches(t, "generator-burst-request", reflect.TypeFor[BurstRequest](), false)
	assertMatches(t, "generator-rate-request", reflect.TypeFor[RateRequest](), false)
	assertMatches(t, "generator-status", reflect.TypeFor[Status](), true)
	assertMatches(t, "error-response", reflect.TypeFor[ErrorResponse](), true)
	assertMatches(t, "health-response", reflect.TypeFor[HealthResponse](), false, true)
}

func TestValidationBoundsMatchTheContract(t *testing.T) {
	start := loadSchema(t, "generator-start-request")
	if got := start.Properties["contestId"].Pattern; got != uuidRe.String() {
		t.Errorf("contestId pattern: contract %q, generator %q", got, uuidRe.String())
	}
	if got := start.Properties["codes"].Items.Pattern; got != codeRe.String() {
		t.Errorf("codes pattern: contract %q, generator %q", got, codeRe.String())
	}
	rate := start.Properties["ratePerSec"]
	if *rate.Minimum != minRate || *rate.Maximum != maxRate {
		t.Errorf("rate bounds: contract [%v, %v], generator [%v, %v]", *rate.Minimum, *rate.Maximum, minRate, maxRate)
	}
	burst := loadSchema(t, "generator-burst-request").Properties["durationSec"]
	if *burst.Minimum != minBurstSec || *burst.Maximum != maxBurstSec {
		t.Errorf("burst duration bounds: contract [%v, %v], generator [%v, %v]", *burst.Minimum, *burst.Maximum, minBurstSec, maxBurstSec)
	}
}
