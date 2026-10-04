import { copyGeneratedJson } from '@interactive-project/protocol/generation/json';

const hardLimits = Object.freeze({ maxQueue: 256, maxQueueBytes: 1048576, maxRetentionMs: 2592000000, maxAttempts: 5, maxPerFlush: 25, maxSinks: 16 });
const defaultLimits = Object.freeze({ maxQueue: 128, maxQueueBytes: 262144, maxRetentionMs: 604800000, maxAttempts: 3, maxPerFlush: 25, maxSinks: 4 });
const eventLimits = Object.freeze({ maxBytes: 1048576, maxDepth: 32, maxCollectionSize: 1000, maxStringLength: 4000, maxNodes: 10000 });
const units = Object.freeze({ day: 86400000, hour: 3600000, exact: 1 });

export class TelemetryError extends Error {
  constructor(code) { super('Telemetry operation rejected.'); this.name = 'TelemetryError'; this.code = code; }
}

class CancellationChannel {
  aborted = false;
  #listeners = new Set();
  onCancel(listener) {
    if (typeof listener !== 'function') throw new TelemetryError('telemetry.options');
    if (this.aborted) { try { listener(); } catch {} return () => {}; }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  cancel() {
    if (this.aborted) return;
    this.aborted = true;
    for (const listener of this.#listeners) { try { listener(); } catch {} }
    this.#listeners.clear();
  }
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function projectedPayload(event, includeAssessmentResult) {
  const payload = event.payload;
  switch (event.type) {
    case 'interactive-project/activity.started':
    case 'interactive-project/attempt.started':
    case 'interactive-project/attempt.submitted':
    case 'interactive-project/answer.changed':
    case 'interactive-project/answer.submitted':
    case 'interactive-project/hint.requested':
    case 'interactive-project/diagram.nodeCreated':
    case 'interactive-project/whiteboard.objectCreated':
      return { revision: payload.revision };
    case 'interactive-project/activity.resumed':
      return { revision: payload.revision, snapshotVersion: payload.snapshotVersion };
    case 'interactive-project/activity.failed':
      return { code: payload.code, phase: payload.phase };
    case 'interactive-project/code.executed':
      return { revision: payload.revision, status: payload.status };
    case 'interactive-project/simulation.started':
    case 'interactive-project/simulation.paused':
    case 'interactive-project/simulation.resumed':
    case 'interactive-project/simulation.stopped':
      return { revision: payload.revision };
    case 'interactive-project/simulation.parameterChanged':
      return { revision: payload.revision };
    case 'interactive-project/activity.completed': {
      const result = { status: payload.result.status };
      if (includeAssessmentResult && payload.result.score) result.score = { value: payload.result.score.value, scale: payload.result.score.scale };
      return { result };
    }
    default:
      return {};
  }
}

function projectEvent(event, { includeIdentifiers, includeAssessmentResult, timeResolution }) {
  const unit = units[timeResolution];
  const record = {
    telemetryVersion: '1.0.0',
    idempotencyKey: event.id,
    eventType: event.type,
    activityType: event.activityType,
    observedAt: Math.floor(event.timestamp / unit) * unit,
    payload: projectedPayload(event, includeAssessmentResult)
  };
  if (includeIdentifiers) {
    record.identifiers = Object.fromEntries(['activityId', 'sessionId', 'sourceId', 'sequence', 'attemptId', 'correlationId', 'causationEventId', 'causationActionId'].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
  }
  return freezeTree(record);
}

function byteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

/** Consent-gated, in-memory exporter queue. It never publishes into the activity event bus. */
export function createTelemetryExporter(options = {}) {
  if (!options || typeof options.validate !== 'function') throw new TelemetryError('telemetry.options');
  if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== 'function') throw new TelemetryError('telemetry.options');
  if (options.now !== undefined && typeof options.now !== 'function') throw new TelemetryError('telemetry.options');
  const policy = options.policy ?? {};
  for (const key of ['includeIdentifiers', 'includeAssessmentResult']) if (policy[key] !== undefined && typeof policy[key] !== 'boolean') throw new TelemetryError('telemetry.options');
  const timeResolution = policy.timeResolution ?? 'day';
  if (!Object.hasOwn(units, timeResolution)) throw new TelemetryError('telemetry.options');
  if (options.sinks !== undefined && !Array.isArray(options.sinks)) throw new TelemetryError('telemetry.options');
  const limits = { ...defaultLimits };
  for (const [key, maximum] of Object.entries(hardLimits)) {
    if (options[key] === undefined) continue;
    const value = options[key];
    const minimum = key === 'maxRetentionMs' ? 1 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TelemetryError('telemetry.options');
    limits[key] = value;
  }

  const validate = options.validate;
  let onDiagnostic = options.onDiagnostic ?? null;
  let enabled = options.enabled ?? true;
  let consent = options.consent ?? false;
  if (typeof enabled !== 'boolean' || typeof consent !== 'boolean') throw new TelemetryError('telemetry.options');
  const sinks = new Map();
  const queue = [];
  const counters = { accepted: 0, rejected: 0, delivered: 0, dropped: 0, failedAttempts: 0 };
  let queueBytes = 0, disposed = false, flushing = false, active = null, epoch = 0, previousNow = 0;

  function report(code) {
    if (!onDiagnostic) return;
    try {
      const result = onDiagnostic(Object.freeze({ code }));
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch { /* Diagnostics must not affect activity or exporter state. */ }
  }

  function dropQueue(code) {
    if (!queue.length) return;
    counters.dropped += queue.length;
    queue.length = 0;
    queueBytes = 0;
    report(code);
  }

  function currentTime() {
    let value;
    try { value = (options.now ?? Date.now)(); } catch { return null; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    previousNow = Math.max(previousNow, value);
    return previousNow;
  }

  function pruneExpired(now) {
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) if (now - queue[i].createdAt >= limits.maxRetentionMs) {
      const [item] = queue.splice(i, 1);
      queueBytes -= item.bytes;
      removed++;
    }
    if (removed) { counters.dropped += removed; report('telemetry.expired'); }
  }

  function registerSink(sink) {
    if (disposed) throw new TelemetryError('telemetry.disposed');
    if (!sink || typeof sink.id !== 'string' || !sink.id.trim() || typeof sink.write !== 'function') throw new TelemetryError('telemetry.options');
    if (sinks.has(sink.id) || sinks.size >= limits.maxSinks) throw new TelemetryError('telemetry.sinks');
    const stableSink = Object.freeze({ id: sink.id, write: sink.write });
    sinks.set(sink.id, stableSink);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      sinks.delete(stableSink.id);
      const remaining = [];
      for (const item of queue) {
        if (item.sinkId === stableSink.id) { queueBytes -= item.bytes; counters.dropped++; }
        else remaining.push(item);
      }
      queue.splice(0, queue.length, ...remaining);
      if (active?.sinkId === stableSink.id) { epoch++; active.signal.cancel(); }
      report('telemetry.sinkRemoved');
    };
  }

  for (const sink of options.sinks ?? []) registerSink(sink);

  function track(input) {
    if (disposed) return reject('telemetry.disposed');
    if (!enabled) return reject('telemetry.disabled');
    if (!consent) return reject('telemetry.consent');
    const now = currentTime();
    if (now === null) return reject('telemetry.clock');
    pruneExpired(now);
    if (!sinks.size) return reject('telemetry.noSinks');
    const copied = copyGeneratedJson(input, eventLimits);
    if (!copied.valid) return reject('telemetry.invalid');
    try {
      const result = validate(copied.value);
      if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); return reject('telemetry.invalid'); }
      if (!result || result.valid !== true) return reject('telemetry.invalid');
    } catch { return reject('telemetry.invalid'); }

    let record, bytes;
    try {
      record = projectEvent(copied.value, {
        includeIdentifiers: policy.includeIdentifiers === true,
        includeAssessmentResult: policy.includeAssessmentResult === true,
        timeResolution
      });
      bytes = byteLength(record);
    } catch { return reject('telemetry.invalid'); }
    const needed = sinks.size;
    if (queue.length + needed > limits.maxQueue || queueBytes + bytes * needed > limits.maxQueueBytes) return reject('telemetry.backpressure');
    for (const sink of sinks.values()) { queue.push({ sinkId: sink.id, record, bytes, createdAt: now, attempts: 0 }); queueBytes += bytes; }
    counters.accepted++;
    return { accepted: true, queued: needed };
  }

  function reject(code) { counters.rejected++; report(code); return { accepted: false, code }; }

  async function flush({ limit = limits.maxPerFlush } = {}) {
    if (disposed) return { processed: 0, remaining: 0, code: 'telemetry.disposed' };
    if (!enabled) return { processed: 0, remaining: queue.length, code: 'telemetry.disabled' };
    if (!consent) return { processed: 0, remaining: queue.length, code: 'telemetry.consent' };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.maxPerFlush) throw new TelemetryError('telemetry.options');
    if (flushing) return { processed: 0, remaining: queue.length, code: 'telemetry.busy' };
    flushing = true;
    let processed = 0;
    const blockedSinks = new Set();
    try {
      const now = currentTime();
      if (now === null) return { processed, remaining: queue.length, code: 'telemetry.clock' };
      pruneExpired(now);
      while (queue.length && processed < limit && enabled && consent && !disposed) {
        const index = queue.findIndex(item => !blockedSinks.has(item.sinkId));
        if (index < 0) break;
        const item = queue[index], sink = sinks.get(item.sinkId);
        if (now - item.createdAt >= limits.maxRetentionMs) { queue.splice(index, 1); queueBytes -= item.bytes; counters.dropped++; report('telemetry.expired'); continue; }
        if (!sink) { queue.splice(index, 1); queueBytes -= item.bytes; counters.dropped++; report('telemetry.sinkRemoved'); continue; }
        const signal = new CancellationChannel(), currentEpoch = epoch;
        active = { sinkId: item.sinkId, item, signal };
        item.attempts++;
        try {
          const result = await sink.write(item.record, Object.freeze({ idempotencyKey: item.record.idempotencyKey, signal }));
          if (disposed || !enabled || !consent || epoch !== currentEpoch || signal.aborted) break;
          if (result === false || result?.accepted === false) throw new Error('sink rejected');
          const currentIndex = queue.indexOf(item);
          if (currentIndex >= 0) { queue.splice(currentIndex, 1); queueBytes -= item.bytes; counters.delivered++; }
          processed++;
        } catch {
          if (disposed || !enabled || !consent || epoch !== currentEpoch || signal.aborted) break;
          counters.failedAttempts++;
          processed++;
          report('telemetry.sink');
          blockedSinks.add(item.sinkId);
          const currentIndex = queue.indexOf(item);
          if (item.attempts >= limits.maxAttempts && currentIndex >= 0) {
            queue.splice(currentIndex, 1); queueBytes -= item.bytes; counters.dropped++; report('telemetry.dropped');
          } else if (currentIndex >= 0) {
            queue.splice(currentIndex, 1);
            const nextSameSink = queue.findIndex(queued => queued.sinkId === item.sinkId);
            if (nextSameSink < 0) queue.push(item);
            else queue.splice(nextSameSink, 0, item);
          }
        } finally {
          if (active?.item === item) active = null;
        }
      }
      return { processed, remaining: queue.length };
    } finally { flushing = false; }
  }

  function setConsent(value) {
    if (typeof value !== 'boolean') throw new TelemetryError('telemetry.options');
    if (consent === value) return;
    consent = value;
    if (!value) { epoch++; active?.signal.cancel(); dropQueue('telemetry.revoked'); }
  }

  function setEnabled(value) {
    if (typeof value !== 'boolean') throw new TelemetryError('telemetry.options');
    if (enabled === value) return;
    enabled = value;
    if (!value) { epoch++; active?.signal.cancel(); dropQueue('telemetry.disabled'); }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    epoch++;
    active?.signal.cancel();
    dropQueue('telemetry.disposed');
    sinks.clear();
    onDiagnostic = null;
  }

  function stats() {
    return Object.freeze({ enabled, consent, disposed, queued: queue.length, queueBytes, active: active !== null, ...counters });
  }

  return Object.freeze({ registerSink, track, flush, setConsent, setEnabled, dispose, stats });
}
