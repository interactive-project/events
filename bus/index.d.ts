import type {ActivityEvent} from '../types/events.js';
export type Frozen<T>=T extends object?{readonly [P in keyof T]:Frozen<T[P]>}:T;
export type BusCode='bus.options'|'bus.disposed'|'bus.subscribers'|'bus.backpressure'|'bus.invalid'|'bus.identity'|'bus.duplicate'|'bus.conflict'|'bus.sequence'|'bus.subscriber'|'bus.yield';
export interface EventBusOptions{
 activityId:string;sessionId:string;sourceId:string;
 validate(event:Frozen<ActivityEvent>):{valid:boolean};
 onDiagnostic?(diagnostic:Readonly<{code:BusCode}>):unknown;
 maxPending?:number;maxPendingBytes?:number;maxHistory?:number;maxHistoryBytes?:number;maxPerFlush?:number;maxSubscribers?:number;
}
export interface EventBus{
 subscribe(listener:(event:Frozen<ActivityEvent>)=>unknown,options?:{replay?:boolean}):()=>void;
 publish(input:unknown):{accepted:true;delivery:'delivered'|'queued'}|{accepted:false;code:BusCode};
 flush():void;dispose():void;
 stats():Readonly<{disposed:boolean;subscribers:number;pending:number;pendingBytes:number;history:number;historyBytes:number;nextSequence:number}>;
}
export declare class EventBusError extends Error{readonly code:BusCode}
export declare function createEventBus(options:EventBusOptions):EventBus;
