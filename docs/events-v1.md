# Activity event contract v1

An ActivityEvent is plain portable JSON with protocolVersion and eventVersion exactly 1.0.0, lowercase UUIDv4 id/activityId/sessionId/sourceId, cataloged namespaced type, Protocol ActivityType, nonnegative safe-integer sequence, timestamp and typed payload. attemptId, correlationId, causationEventId, causationActionId and optional namespaced extensions are supported. The immutable id identifies this occurrence across local processing, retries and remote export; sourceId identifies one producer lifetime/sequence stream, not a person. No vendor/native objects, subscriptions, errors, signals or user identity records belong in portable events.

Timestamp is an integer number of milliseconds since the Unix epoch, captured from a host-injected clock, with 0..Number.MAX_SAFE_INTEGER bounds. It is observation metadata, not the ordering authority. Clocks can skew, repeat or move backward. sourceId+sequence orders one producer stream; a new lifetime gets a new sourceId and sequence starts at zero. Engines monotonically increment the sequence per committed emission, without reuse. Different sources/sessions have no total ordering inferred from timestamps or UUIDs. Receivers may see gaps, duplicates and out-of-order remote arrivals; the envelope validator is stateless and does not invent delivery guarantees.

## Correlation and causation

activityId is the logical authored activity; sessionId is its live session. attemptId is mandatory on attempt.started/submitted and answer.changed/submitted, and identifies the active attempt within that session. Other events carry it when applicable. IDs use Protocol's exact identity contract and cannot contain credential or learner profile objects. correlationId optionally ties a trusted host operation across sources. causationEventId references a preceding event (never the same event); causationActionId references the accepted/failed action responsible for this emission. A known interaction's causationActionId must match payload.actionId. Missing causation is allowed for host/system actions; absence does not imply a globally initial event. Cross-source chains require host correlation; a single event cannot prove remote existence or absence of longer cycles.

activity.completed embeds a Protocol completed or unevaluable result, never pending/failed. Result activity/session/attempt IDs must match the event. A whiteboard can complete with an unevaluable/unassessed result; completion does not imply a zero score. Shared action/result/snapshot schemas remain owned by Protocol, resolved locally and never fetched from data.

## Catalog and exact payloads

Wire names use the interactive-project/ namespace; the familiar activity.created notation is the suffix, not an unnamespaced wire type. catalogs/events.v1.json enumerates 19 types and required payload fields; closed payload schemas reject accidental raw answers/source/output and unregistered additions.

| Suffix | Required payload and meaning |
| --- | --- |
| activity.created | engineId, engineStateVersion; a session engine was successfully constructed |
| activity.started | revision; initial active transition committed |
| activity.resumed | revision, snapshotVersion; a validated compatible restore committed |
| activity.interacted | actionId, actionType, revision; an accepted domain action transition committed |
| activity.completed | result; terminal completion includes completed or explicitly unevaluable assessment |
| activity.failed | code, phase, safe message; initialization/dispatch/evaluation/restore failed |
| attempt.started | revision; a new correlated attempt became active |
| attempt.submitted | revision; the attempt submission committed, before any pending evaluation finishes |
| answer.changed | answerId, revision; answer reference changed, without answer content |
| answer.submitted | answerId, revision; answer submission committed |
| hint.requested | hintId, revision; a hint reference was requested, without hint/learner text |
| code.executed | executionId, status, revision; completed/failed/timeout/cancelled execution observation, without source/output |
| diagram.nodeCreated | nodeId, revision; node creation committed |
| whiteboard.objectCreated | objectId, revision; object creation committed |
| simulation.started/paused/resumed/stopped | tick, revision; the named simulation lifecycle transition committed |
| simulation.parameterChanged | parameterId, revision; parameter reference changed, without exporting its value |

The code, diagram, whiteboard and simulation names require the matching activityType. Domain-local reference IDs are bounded nonempty strings; UUID occurrence/session/source/attempt/action/execution identity remains separate. Failed messages are public, safe static descriptions, never native stack traces or credentials. A schema cannot prove message privacy; the host/producer must enforce that policy.

This issue defines when the semantic observation exists. Detailed local subscribe/unsubscribe, buffering, replay, reentrancy, failure isolation and exact multi-event emission ordering are implemented by events#2 and Core transition issues. events#3 adds an optional consent-aware, redacted export boundary; durable network delivery, consent UX, persistent retry retention and remote reconciliation remain host-owned. Nothing in this envelope establishes exactly-once delivery. Retried export retains id, sourceId, sequence, timestamp and payload; creating a different id for a retry misrepresents an occurrence. See [telemetry export v1](telemetry-v1.md).

## Extensions, evolution and compatibility

Unknown optional namespaced extensions are ignored semantically and preserved intact, including nested JSON. They cannot grant required capabilities, register a sink/driver or authorize network access. Required behavior must be checked using the trusted Protocol capability/permission gate before activity creation. Unknown event type or eventVersion is rejected by this catalog validator, not coerced to a familiar lifecycle event. A receiver needing opaque archival may retain the original bytes under a separate host policy without treating unsupported data as a validated event.

Envelope, timestamp units, sequence scope, payload meanings and exhaustive type/status additions are versioned contracts. Changing any required fields, ordering/meaning or score semantics is breaking for affected consumers; new optional top-level fields are also breaking because this version is closed. Optional preserved extension data is compatible inside its declared boundary. A new event type/version requires an explicit catalog/schema ID and advertised exact support; a package minor alone is not wire acceptance. Follow Protocol evolution-v1: explicit source/target migration validators, original retention, no silent data loss, and oldest/newest fixture gates. Schema assets for 1.0.0 stay immutable; data cannot request remote schema retrieval.

## Verification and limits

The optional Node validateEvent adapter applies bounded JSON copying before Ajv schema/semantic validation: 1 MiB encoded, depth 32, collection size 1,000, string length 4,000 Unicode code points and 10,000 JSON values. No truncation or getter/serializer execution. Structural errors use event.schema; correlation failures use event.causation/event.identity with RFC 6901 pointers and safe static text; invalid JSON uses Protocol input/generation codes.

npm test runs 33 valid/invalid fixtures in JavaScript and independently validates structure in Python. Fixtures cover every catalog entry, unassessed completion, identity mismatch, missing attempts, wrong domains, unsupported type/version, illegal raw data, timestamps/sequences and causation. TypeScript consumers compile using ES2022 without DOM libraries; schema/type consistency verifies envelope and payloads against the exact Protocol contracts. Tests retain optional extension data, preserve input and check stateless clock/sequence behavior. No engine, delivery bus, framework or remote exporter is claimed by #1.

Existing Protocol wire schemas remain unchanged; Events 0.1.0 implements event 1.0.0 in this repository, without asserting an npm release. The initial fixture event contract has no prior released data requiring migration. Shared decision: improvement-proposals/decisions/events-v1.md.
