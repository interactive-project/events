import type { ActivityEvent, EventType } from '../types/events.js';

export type TelemetryCode = 'telemetry.options' | 'telemetry.disabled' | 'telemetry.consent' | 'telemetry.noSinks' | 'telemetry.invalid' | 'telemetry.backpressure' | 'telemetry.clock' | 'telemetry.sinks' | 'telemetry.sink' | 'telemetry.sinkRemoved' | 'telemetry.expired' | 'telemetry.dropped' | 'telemetry.revoked' | 'telemetry.disposed' | 'telemetry.busy';
export interface TelemetryCancellationSignal {
  readonly aborted: boolean;
  onCancel(listener: () => void): () => void;
}
export interface TelemetryScore { readonly value: number; readonly scale: 'normalized' }
export interface TelemetryRecord {
  readonly telemetryVersion: '1.0.0';
  readonly idempotencyKey: string;
  readonly eventType: EventType;
  readonly activityType: string;
  readonly observedAt: number;
  readonly identifiers?: Readonly<{ activityId?: string; sessionId?: string; sourceId?: string; sequence?: number; attemptId?: string; correlationId?: string; causationEventId?: string; causationActionId?: string }>;
  readonly payload: Readonly<{
    revision?: number; status?: string; phase?: string; code?: string; snapshotVersion?: '1.0.0';
    result?: Readonly<{ status: 'completed' | 'unevaluable'; score?: TelemetryScore }>;
  }>;
}
export interface TelemetrySink {
  id: string;
  write(record: TelemetryRecord, context: Readonly<{ idempotencyKey: string; signal: TelemetryCancellationSignal }>): void | boolean | { accepted: boolean } | Promise<void | boolean | { accepted: boolean }>;
}
export interface TelemetryPolicy {
  /** Explicitly includes activity/session/source/attempt and causation identifiers. Default false. */
  includeIdentifiers?: boolean;
  /** Explicitly includes normalized completion score; evidence references are always excluded. Default false. */
  includeAssessmentResult?: boolean;
  /** Reduces event observation time; defaults to UTC-day precision. */
  timeResolution?: 'day' | 'hour' | 'exact';
}
export interface TelemetryOptions {
  validate(event: unknown): { valid: boolean };
  sinks?: TelemetrySink[];
  enabled?: boolean;
  consent?: boolean;
  policy?: TelemetryPolicy;
  onDiagnostic?(diagnostic: Readonly<{ code: TelemetryCode }>): unknown;
  /** Monotonic milliseconds, used only for queue retention. */
  now?(): number;
  maxQueue?: number;
  maxQueueBytes?: number;
  maxRetentionMs?: number;
  maxAttempts?: number;
  maxPerFlush?: number;
  maxSinks?: number;
}
export type TelemetryTrackResult = { accepted: true; queued: number } | { accepted: false; code: TelemetryCode };
export interface TelemetryExporter {
  registerSink(sink: TelemetrySink): () => void;
  track(event: ActivityEvent | unknown): TelemetryTrackResult;
  flush(options?: { limit?: number }): Promise<{ processed: number; remaining: number; code?: TelemetryCode }>;
  setConsent(consent: boolean): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
  stats(): Readonly<{ enabled: boolean; consent: boolean; disposed: boolean; queued: number; queueBytes: number; active: boolean; accepted: number; rejected: number; delivered: number; dropped: number; failedAttempts: number }>;
}
export declare class TelemetryError extends Error { readonly code: TelemetryCode }
export declare function createTelemetryExporter(options: TelemetryOptions): TelemetryExporter;
