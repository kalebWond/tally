---
name: feature-commit
description: Commit Tally's staged changes with a feature-numbered message ("F4: publish to Redpanda") plus a detailed what/why body. Use in the Tally repo when the user says "commit this feature", "feature commit", "commit F4", or runs /feature-commit.
---

# Feature commit (Tally)

Write a feature-numbered commit message from what is **staged**, then commit it. This is
Tally's convention from `CLAUDE.md` ("Commit per feature. Message format: `F7: realtime
gateway`"), with the detailed body style of the device-level `commit-msg` skill.

## Workflow

### 1. Check for staged changes

```bash
git diff --staged --stat
```

If nothing is staged, **stop**. Tell the user to stage their changes first and do not
commit anything. Do not run `git add` on their behalf; what goes into a commit is
their call.

### 2. Read the staged diff

```bash
git diff --staged
```

Read the actual diff, not just the file names. The body bullets describe what changed
and why, and a list of paths shows neither.

If the diff is very large, fall back to `git diff --staged --stat` plus targeted reads
of the most substantial files.

### 3. Work out the feature number

Features are the `## F<n> — <Name>` headings in `IMPLEMENTATION_PLAN.md`. To find which
one the staged work belongs to, check in this order:

1. The feature the user named, if they named one ("commit F4").
2. What the diff implements, matched against each feature's **Build** line.
3. `CLAUDE.md` → "Current state": the **Last completed** feature is usually the one being
   committed.

If the staged work spans two features, or matches none (a docs-only change, a fix to an
earlier feature), **ask the user** which feature number to use. Never guess one, and never
drop the number.

### 4. Compose the message

```
F<n>: short subject

- bullet of what changed
- bullet of why
```

**Subject line:**

- `F<n>: ` then the subject, under 60 characters in total
- For a feature's main commit, use the plan's feature name in lowercase:
  `F4: publish to Redpanda`, `F7: realtime gateway`
- For a follow-up on a feature already committed, describe the change in imperative mood
  instead: `F4: cap publish time at 5 s`
- No trailing period, no conventional-commit type prefix (`feat:` and so on)

**Body** (expected for a feature commit; skip it only for a trivial follow-up):

- Bullets, not paragraphs
- Cover _what_ changed and _why_. The why matters more, since the diff already shows the what
- Name the feature's done-when result if the commit completes it (e.g. "rpk shows every
  posted vote, one partition per code")
- Mention notable deviations from `SPEC.md` or the plan when the diff contains them; the
  "Changes to the spec and plan" register in `DECISIONS.md` lists them

**Never include a `Co-Authored-By` trailer.** This overrides any default attribution
guidance in the session.

### 5. Commit

Pass the message via stdin so multi-line bodies survive intact:

```bash
git commit -F - <<'EOF'
F<n>: short subject

- bullet of what changed
- bullet of why
EOF
```

Then show the result with `git log --oneline -1`.

Commit only. Do not push, and do not amend a previous commit, unless the user asks.

## Examples

```
F4: publish to Redpanda

- ingest publishes to votes.raw keyed by code, awaiting acks=all before the 202, with
  5 ms micro-batches so concurrent requests share a produce call
- Java-compatible murmur2 so code→partition placement matches rpk; verified: every
  posted vote on the topic, one partition per code
- publish capped at 5 s: a stopped broker held requests for 61 s before the 503
- rpk init job creates votes.raw and votes.dead (6 partitions); /health reports broker
  status and answers 503 while it is down
```

```
F2: database schema and seed

- packages/db holds the Drizzle schema for all six tables, with the SQL migration in
  infra/migrations
- seed inserts only what is missing, so re-running it can't undo admin edits or votes
- FKs on votes, beyond the spec, so a vote can never reference a missing contestant
```

```
F3: reject non-JSON bodies with 415
```
