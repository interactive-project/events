# Privacy-aware telemetry export v1

`@interactive-project/events/telemetry` is an optional consumer of already committed ActivityEvents. It has no import or callback into an engine/EventBus and cannot roll back or block activity state transitions. `track()` validates and projects a bounded copy, then queues it in memory; only an explicit host `flush()` invokes a sink. Nothing is persisted or sent automatically.

## Data minimization and opt-in

Consent defaults to false. With consent absent, `track()` rejects with a static `telemetry.consent` code and queues nothing. A global `enabled` kill-switch is also available. `setConsent(false)` revokes future collection, clears pending records, and signals active sinks to cancel. Re-consent never restores erased queue entries. Cancellation is cooperative: a request already accepted by a remote server cannot be recalled.

The projection defaults to UTC-day time precision and excludes activity/session/source/attempt/correlation identifiers, event sequence, completion score/evidence, free-text failure messages, answer/hint/execution/object IDs, action type, and arbitrary `extensions`. The occurrence UUID is retained only as `idempotencyKey`, so a retry identifies the same event but does not expose a session join key. The host must explicitly set `policy.includeIdentifiers` to include event/session/source/attempt/causation IDs, `policy.includeAssessmentResult` to include normalized completion score, or `policy.timeResolution` to `hour`/`exact`. Evidence references remain excluded in every mode.

Raw learner answers, source code, and personal identity are not part of the event v1 wire catalog. `track()` validates against the closed event contract, so extra raw fields in an event are rejected; arbitrary optional extension JSON is omitted from the telemetry projection even when accepted by the event validator. This API has no raw-content or personal-identity enrichment hook. Adding one requires a separate explicit host/privacy contract rather than a vendor sink silently reading engine state.

The projection is an allowlist, not a generic deep-copy/redactor. It retains event/activity type and only low-risk categorical/status/revision fields; failure messages, assessment evidence and domain reference IDs are omitted. A sink receives an immutable `TelemetryRecord` plus the same idempotency key in its write context. It should use that key for deduplication and may map the record to xAPI or another evidence format. No xAPI package, vocabulary, network client or vendor schema is an Events dependency.

## Offline queue, retention and retries

The queue is per sink and memory-only. The host controls when `flush()` runs (for example, after connectivity returns); no timers, network detection, background task, or durable browser storage are installed. Defaults are 128 queued deliveries, 256 KiB, seven-day retention, three write attempts, 25 deliveries per flush and four sinks. Each option can only tighten its hard ceiling (256 entries, 1 MiB, 30 days, five attempts, 25 per flush, 16 sinks). The smallest limits still reject if a single batch cannot fit.

Queue admission is atomic across currently registered sinks. Backpressure rejects the telemetry copy and reports `telemetry.backpressure`; it never rejects the activity event. Entries expire by the host-supplied monotonic retention clock; an invalid clock refuses queueing. A write rejection/throw is retried only by a later explicit flush, always with the original idempotency key. Retry attempts are bounded; exhaustion, expiry, removed sinks and consent revocation increment dropped counters and emit static diagnostics. A failed sink blocks later entries for that sink to preserve its event order, while other sinks can continue. There is no exactly-once or durable-delivery guarantee: sinks need their own idempotency retention, and process termination loses the local queue.

Sinks can subscribe to the host-neutral cancellation channel. Consent revocation, disabling or disposal aborts in-flight work and purges queued copies. A sink must bridge cancellation to its own transport; JavaScript cannot preempt a callback that ignores cancellation. `onDiagnostic` and `stats()` expose codes/counters only—never event contents, IDs, exception text or credentials. Diagnostic callback failures are isolated.

## Verification and boundaries

`scripts/check-telemetry.mjs` checks deny-by-default consent, disabled-state equivalence with local event delivery, projection allowlists, explicit identifier/score opt-in, rejection of raw answer/source fields, extension removal, offline queueing, per-sink ordering, idempotent retries, retry exhaustion, bounded admission, retention, consent revocation and cancellation. It also verifies diagnostics contain codes only.

This subpath does not define activity-state persistence, a learner identity store, legal consent UX, a telemetry vendor, xAPI mappings, encryption-at-rest, or durable offline storage. Hosts own consent capture, transport security, remote retention/deletion, sink authorization, and any future enrichment. Existing event and Protocol wire schemas are unchanged.
