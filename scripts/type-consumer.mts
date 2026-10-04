import { eventTypes,type ActivityEvent,type EventPayloads } from '@interactive-project/events';
import { validateEvent } from '@interactive-project/events/validation';
function observe(event:ActivityEvent){
 if(event.type==='interactive-project/answer.changed'){const attempt:string=event.attemptId;const answerId:string=event.payload.answerId;void attempt;void answerId;}
 if(event.type==='interactive-project/code.executed'){const domain:'interactive-project/code'=event.activityType;void domain;}
 if(event.type==='interactive-project/activity.completed'){const status:'completed'|'unevaluable'=event.payload.result.status;void status;}
}
const payload:EventPayloads['interactive-project/code.executed']={executionId:'fixture',status:'completed',revision:0};
// @ts-expect-error Raw source is not in the default event catalog.
const invalid:EventPayloads['interactive-project/code.executed']={...payload,source:'private'};
void invalid;void observe;void eventTypes;void validateEvent;

import {createEventBus,type Frozen} from '@interactive-project/events/bus';
import {createTelemetryExporter,type TelemetrySink} from '@interactive-project/events/telemetry';
const bus=createEventBus({activityId:'fixture',sessionId:'fixture',sourceId:'fixture',validate:()=>({valid:true})});
bus.subscribe(event=>{
 if(event.type==='interactive-project/activity.started'){
  const revision:number=event.payload.revision;void revision;
  // @ts-expect-error Observer data is deeply readonly.
  event.payload.revision=3;
 }
});
const frozen:Frozen<ActivityEvent>|undefined=undefined;void frozen;
const sink:TelemetrySink={id:'example',write:(record,context)=>{const key:string=record.idempotencyKey;context.signal.onCancel(()=>{});void key;}};
const telemetry=createTelemetryExporter({validate:validateEvent,consent:false,sinks:[sink]});
const eventForTelemetry=undefined as unknown as ActivityEvent;
const telemetryResult=telemetry.track(eventForTelemetry);if(!telemetryResult.accepted){const code:string=telemetryResult.code;void code;}
void telemetry.flush();telemetry.dispose();
