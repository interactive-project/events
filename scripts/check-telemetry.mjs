import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEventBus } from '../bus/index.js';
import { createTelemetryExporter } from '../telemetry/index.js';
import { validateEvent } from '../validation/index.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const answer = read('../fixtures/valid/answer.submitted.json');
const completion = read('../fixtures/valid/activity.completed.json');
const started = read('../fixtures/valid/activity.started.json');
const clone = value => JSON.parse(JSON.stringify(value));
let nextId = 1000;
const occurrence = (event, changes = {}) => ({ ...clone(event), id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, ...changes });
const diagnostics = [];

let now = 1000;
const writes = [];
const minimal = createTelemetryExporter({
  validate: validateEvent,
  consent: true,
  now: () => now,
  onDiagnostic: item => diagnostics.push(item),
  sinks: [{ id: 'analytics', async write(record, context) { writes.push({ record, context }); } }]
});
const withExtension = occurrence(answer, { extensions: { 'org.example/future': { learnerAnswer: 'private-answer', sourceCode: 'private-code', email: 'person@example.org' } } });
assert(validateEvent(withExtension).valid, 'opaque extensions remain valid wire data');
assert.deepEqual(minimal.track(withExtension), { accepted: true, queued: 1 });
assert.equal(writes.length, 0, 'track queues only; it does not perform network I/O');
assert.equal(minimal.stats().queued, 1);
assert.deepEqual(await minimal.flush(), { processed: 1, remaining: 0 });
assert.equal(writes.length, 1);
const record = writes[0].record;
assert.equal(record.idempotencyKey, withExtension.id);
assert.equal(writes[0].context.idempotencyKey, withExtension.id);
assert.equal(record.eventType, answer.type);
assert.equal(record.observedAt, Math.floor(answer.timestamp / 86400000) * 86400000);
assert.equal(record.identifiers, undefined);
assert.equal(record.payload.answerId, undefined);
assert.equal(record.payload.revision, answer.payload.revision);
assert.equal(record.extensions, undefined);
assert.equal(JSON.stringify(record).includes('private-answer'), false);
assert.equal(JSON.stringify(record).includes('private-code'), false);
assert.equal(JSON.stringify(record).includes('person@example.org'), false);
assert(Object.isFrozen(record) && Object.isFrozen(record.payload));

const defaultResultWrites = [];
const defaultResult = createTelemetryExporter({ validate: validateEvent, consent: true, sinks: [{ id: 'outcomes', write: record => defaultResultWrites.push(record) }] });
defaultResult.track(occurrence(completion));
await defaultResult.flush();
assert.equal(defaultResultWrites[0].payload.result.status, 'completed');
assert.equal(defaultResultWrites[0].payload.result.score, undefined, 'scores are excluded unless explicitly opted in');

const optedInWrites = [];
const optedIn = createTelemetryExporter({
  validate: validateEvent,
  consent: true,
  policy: { includeIdentifiers: true, includeAssessmentResult: true, timeResolution: 'exact' },
  sinks: [{ id: 'approved-analytics', write: record => optedInWrites.push(record) }]
});
const optedEvent = occurrence(completion);
optedIn.track(optedEvent);
await optedIn.flush();
assert.equal(optedInWrites[0].observedAt, optedEvent.timestamp);
assert.equal(optedInWrites[0].identifiers.activityId, optedEvent.activityId);
assert.equal(optedInWrites[0].identifiers.sessionId, optedEvent.sessionId);
assert.equal(optedInWrites[0].payload.result.score.value, completion.payload.result.score.value);
assert.equal(optedInWrites[0].payload.result.evidence, undefined);

const consentRequired = createTelemetryExporter({ validate: validateEvent, sinks: [{ id: 'never', write: () => assert.fail('No consent: sink must not run') }] });
assert.equal(consentRequired.track(answer).code, 'telemetry.consent');
assert.equal(consentRequired.stats().queued, 0);
const invalidAnswer = occurrence(answer);
invalidAnswer.payload.answer = 'raw learner response';
assert.equal(minimal.track(invalidAnswer).code, 'telemetry.invalid');
const invalidSource = occurrence(read('../fixtures/valid/code.executed.json'));
invalidSource.payload.sourceCode = 'private source';
assert.equal(minimal.track(invalidSource).code, 'telemetry.invalid');

function runLocal(enabled) {
  let activityRevision = 0, sinkCalls = 0;
  const localExporter = createTelemetryExporter({
    validate: validateEvent, enabled, consent: true,
    sinks: [{ id: 'local-test', write: () => { sinkCalls++; } }]
  });
  const event = occurrence(started, { sequence: 0, payload: { revision: 1 } });
  const bus = createEventBus({ activityId: event.activityId, sessionId: event.sessionId, sourceId: event.sourceId, validate: validateEvent });
  bus.subscribe(observation => localExporter.track(observation));
  activityRevision = 1;
  const receipt = bus.publish(event);
  const state = { activityRevision, nextSequence: bus.stats().nextSequence, eventAccepted: receipt.accepted };
  assert.equal(sinkCalls, 0, 'activity publication never waits for telemetry transport');
  const pending = localExporter.stats().queued;
  bus.dispose(); localExporter.dispose();
  return { state, pending };
}
const telemetryDisabled = runLocal(false), telemetryEnabled = runLocal(true);
assert.deepEqual(telemetryDisabled.state, telemetryEnabled.state, 'disabling telemetry cannot alter local event/activity state');
assert.equal(telemetryDisabled.pending, 0);
assert.equal(telemetryEnabled.pending, 1);

const boundedDiagnostics = [];
const bounded = createTelemetryExporter({ validate: validateEvent, consent: true, maxQueue: 1, onDiagnostic: item => boundedDiagnostics.push(item), sinks: [{ id: 'bounded', write() {} }] });
assert.equal(bounded.track(occurrence(answer)).accepted, true);
assert.equal(bounded.track(occurrence(answer)).code, 'telemetry.backpressure');
assert.equal(bounded.stats().queued, 1);
assert.equal(bounded.stats().rejected, 1);
assert.equal(boundedDiagnostics[0].code, 'telemetry.backpressure');

const retryKeys = [], retryDiagnostics = [];
let failOnce = true;
const retrying = createTelemetryExporter({
  validate: validateEvent, consent: true, maxAttempts: 2, onDiagnostic: item => retryDiagnostics.push(item),
  sinks: [{ id: 'retry', write(record, context) { retryKeys.push(context.idempotencyKey); assert.equal(record.idempotencyKey, context.idempotencyKey); if (failOnce) { failOnce = false; throw new Error('do not leak this secret'); } } }]
});
const retryEvent = occurrence(answer);
retrying.track(retryEvent);
assert.deepEqual(await retrying.flush(), { processed: 1, remaining: 1 });
assert.equal(retrying.stats().failedAttempts, 1);
assert.deepEqual(await retrying.flush(), { processed: 1, remaining: 0 });
assert.deepEqual(retryKeys, [retryEvent.id, retryEvent.id]);
assert(retryDiagnostics.every(item => Object.keys(item).length === 1 && item.code.startsWith('telemetry.')));
assert.equal(JSON.stringify(retryDiagnostics).includes('do not leak'), false);

let firstSinkCalls = 0, healthySinkCalls = 0;
const firstSinkKeys = [];
const isolatedSinks = createTelemetryExporter({
  validate: validateEvent, consent: true, maxAttempts: 2,
  sinks: [
    { id: 'temporarily-offline', write(record) { firstSinkKeys.push(record.idempotencyKey); if (++firstSinkCalls === 1) throw new Error('offline'); } },
    { id: 'healthy', write() { healthySinkCalls++; } }
  ]
});
const firstIsolatedEvent = occurrence(answer), secondIsolatedEvent = occurrence(answer);
isolatedSinks.track(firstIsolatedEvent);
isolatedSinks.track(secondIsolatedEvent);
assert.deepEqual(await isolatedSinks.flush({ limit: 4 }), { processed: 3, remaining: 2 });
assert.equal(healthySinkCalls, 2, 'one offline sink does not block another sink');
assert.equal(firstSinkCalls, 1);
assert.deepEqual(await isolatedSinks.flush({ limit: 4 }), { processed: 2, remaining: 0 });
assert.equal(firstSinkCalls, 3, 'retry preserves per-sink FIFO order');
assert.deepEqual(firstSinkKeys, [firstIsolatedEvent.id, firstIsolatedEvent.id, secondIsolatedEvent.id]);

let retryForeverCalls = 0;
const exhausted = createTelemetryExporter({ validate: validateEvent, consent: true, maxAttempts: 2, sinks: [{ id: 'reject', write() { retryForeverCalls++; throw Error('rejected'); } }] });
exhausted.track(occurrence(answer));
await exhausted.flush(); await exhausted.flush();
assert.equal(retryForeverCalls, 2);
assert.equal(exhausted.stats().dropped, 1);
assert.equal(exhausted.stats().queued, 0);

let retentionNow = 10, expiryCalls = 0;
const expiring = createTelemetryExporter({ validate: validateEvent, consent: true, maxRetentionMs: 50, now: () => retentionNow, sinks: [{ id: 'expired', write() { expiryCalls++; } }] });
expiring.track(occurrence(answer)); retentionNow = 100;
assert.equal((await expiring.flush()).remaining, 0);
assert.equal(expiryCalls, 0);
assert.equal(expiring.stats().dropped, 1);

let cancellationStarted, cancelled = false;
const cancellationReady = new Promise(resolve => { cancellationStarted = resolve; });
const revocable = createTelemetryExporter({ validate: validateEvent, consent: true, sinks: [{ id: 'cancellable', write(_record, { signal }) {
  return new Promise(resolve => { signal.onCancel(() => { cancelled = true; resolve(); }); cancellationStarted(); });
} }] });
revocable.track(occurrence(answer));
const inFlight = revocable.flush();
await cancellationReady;
revocable.setConsent(false);
await inFlight;
assert.equal(cancelled, true);
assert.equal(revocable.stats().queued, 0);
assert.equal(revocable.stats().consent, false);

const revokeThenDisable = createTelemetryExporter({ validate: validateEvent, consent: true, sinks: [{ id: 'disabled', write() {} }] });
revokeThenDisable.track(occurrence(answer));
revokeThenDisable.setEnabled(false);
assert.equal(revokeThenDisable.stats().queued, 0);
assert.equal(revokeThenDisable.track(answer).code, 'telemetry.disabled');

const removal = createTelemetryExporter({ validate: validateEvent, consent: true, sinks: [{ id: 'remove', write() {} }] });
const unregister = removal.registerSink({ id: 'later', write() {} });
removal.track(occurrence(answer)); unregister(); unregister();
assert.equal(removal.stats().queued, 1, 'removing a sink purges only that sink copy idempotently');

assert(diagnostics.every(item => item.code.startsWith('telemetry.')));
console.log('Telemetry: consent, minimization, explicit sensitive opt-in, sink isolation, retries/idempotency, bounded retention, cancellation and state independence passed.');
