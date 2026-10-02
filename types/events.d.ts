import type { ActivityType, JsonValue } from '@interactive-project/protocol/types';
import type { Result } from '@interactive-project/protocol/interoperability';
export interface EventIdentity { protocolVersion:'1.0.0';eventVersion:'1.0.0';id:string;activityId:string;activityType:ActivityType;sessionId:string;attemptId?:string;sourceId:string;sequence:number;timestamp:number;causationEventId?:string;causationActionId?:string;correlationId?:string;extensions?:Record<string,JsonValue> }
export interface EventPayloads {
 'interactive-project/activity.created':{engineId:string;engineStateVersion:string};
 'interactive-project/activity.started':{revision:number};
 'interactive-project/activity.resumed':{revision:number;snapshotVersion:'1.0.0'};
 'interactive-project/activity.interacted':{actionId:string;actionType:string;revision:number};
 'interactive-project/activity.completed':{result:Extract<Result,{status:'completed'|'unevaluable'}>};
 'interactive-project/activity.failed':{code:string;phase:'initialization'|'dispatch'|'evaluation'|'restore';message:string};
 'interactive-project/attempt.started':{revision:number};
 'interactive-project/attempt.submitted':{revision:number};
 'interactive-project/answer.changed':{answerId:string;revision:number};
 'interactive-project/answer.submitted':{answerId:string;revision:number};
 'interactive-project/hint.requested':{hintId:string;revision:number};
 'interactive-project/code.executed':{executionId:string;status:'completed'|'failed'|'timeout'|'cancelled';revision:number};
 'interactive-project/diagram.nodeCreated':{nodeId:string;revision:number};
 'interactive-project/whiteboard.objectCreated':{objectId:string;revision:number};
 'interactive-project/simulation.started':{tick:number;revision:number};
 'interactive-project/simulation.paused':{tick:number;revision:number};
 'interactive-project/simulation.resumed':{tick:number;revision:number};
 'interactive-project/simulation.stopped':{tick:number;revision:number};
 'interactive-project/simulation.parameterChanged':{parameterId:string;revision:number};
}
export type EventType=keyof EventPayloads;
type AttemptType='interactive-project/attempt.started'|'interactive-project/attempt.submitted'|'interactive-project/answer.changed'|'interactive-project/answer.submitted';
type DomainType<T extends EventType> = T extends 'interactive-project/code.executed' ? 'interactive-project/code' : T extends 'interactive-project/diagram.nodeCreated' ? 'interactive-project/diagram' : T extends 'interactive-project/whiteboard.objectCreated' ? 'interactive-project/whiteboard' : T extends `interactive-project/simulation.${string}` ? 'interactive-project/simulation' : ActivityType;
export type ActivityEvent = {[T in EventType]:EventIdentity & {type:T;activityType:DomainType<T>;payload:EventPayloads[T]} & (T extends AttemptType?{attemptId:string}:{})}[EventType];
