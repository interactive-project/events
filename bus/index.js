import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const limits={maxPending:128,maxPendingBytes:4194304,maxHistory:128,maxHistoryBytes:4194304,maxPerFlush:1024,maxSubscribers:128};
export class EventBusError extends Error{constructor(code){super('Event bus operation rejected.');this.name='EventBusError';this.code=code;}}
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
/** One local producer stream; trusted validation and post-commit publication only. */
export function createEventBus(options){
 if(!options||!['activityId','sessionId','sourceId'].every(k=>uuid.test(options[k]))||typeof options.validate!=='function')throw new EventBusError('bus.options');
 const config={...limits};
 for(const key of Object.keys(limits))if(options[key]!==undefined){const v=options[key];if(!Number.isSafeInteger(v)||v<(['maxHistory','maxHistoryBytes'].includes(key)?0:1)||v>limits[key])throw new EventBusError('bus.options');config[key]=v;}
 const identity={activityId:options.activityId,sessionId:options.sessionId,sourceId:options.sourceId},validate=options.validate;
 let onDiagnostic=typeof options.onDiagnostic==='function'?options.onDiagnostic:null;
 let disposed=false,draining=false,reporting=false,nextSequence=0,pendingBytes=0,historyBytes=0;
 const subscribers=new Set(),queue=[],history=[],retained=new Map();
 function report(code){if(disposed||reporting||!onDiagnostic)return;reporting=true;try{const result=onDiagnostic(Object.freeze({code}));if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});}catch{}finally{reporting=false;}}
 const reject=code=>{report(code);return{accepted:false,code};};
 function deliver(task){
  for(const subscriber of task.recipients){if(disposed)break;if(!subscriber.active)continue;
   try{const result=subscriber.listener(task.event);if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>report('bus.subscriber'));}
   catch{report('bus.subscriber');}
  }
  task.delivered=!disposed;
 }
 function flush(){
  if(disposed||draining)return;
  draining=true;
  try{let count=0;while(queue.length&&!disposed&&count++<config.maxPerFlush){const task=queue.shift();pendingBytes-=task.bytes;deliver(task);}if(queue.length)report('bus.yield');}
  finally{draining=false;}
 }
 function subscribe(listener,{replay=false}={}){
  if(disposed)throw new EventBusError('bus.disposed');
  if(typeof listener!=='function'||typeof replay!=='boolean')throw new EventBusError('bus.options');
  if(subscribers.size>=config.maxSubscribers)throw new EventBusError('bus.subscribers');
  const replayBytes=replay?history.reduce((n,h)=>n+h.bytes,0):0;
  if(replay&&(queue.length+history.length>config.maxPending||pendingBytes+replayBytes>config.maxPendingBytes))throw new EventBusError('bus.backpressure');
  const record={listener,active:true};subscribers.add(record);
  if(replay)for(const item of history){queue.push({event:item.event,bytes:item.bytes,recipients:[record],delivered:false});pendingBytes+=item.bytes;}
  flush();
  return()=>{record.active=false;subscribers.delete(record);record.listener=null;};
 }
 function publish(input){
  if(disposed)return reject('bus.disposed');
  const copied=copyGeneratedJson(input,{maxBytes:1048576,maxDepth:32,maxCollectionSize:1000,maxStringLength:4000,maxNodes:10000});
  if(!copied.valid)return reject('bus.invalid');
  const event=copied.value;
  try{const result=validate(event);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});return reject('bus.invalid');}if(!result||result.valid!==true)return reject('bus.invalid');}
  catch{return reject('bus.invalid');}
  if(disposed)return reject('bus.disposed');
  if(!Object.keys(identity).every(k=>event[k]===identity[k]))return reject('bus.identity');
  const previous=retained.get(event.id);
  if(previous)return canonical(previous.event)===canonical(event)?{accepted:false,code:'bus.duplicate'}:reject('bus.conflict');
  if(!Number.isSafeInteger(event.sequence)||event.sequence!==nextSequence)return reject('bus.sequence');
  const bytes=new TextEncoder().encode(JSON.stringify(event)).byteLength;
  if(queue.length>=config.maxPending||pendingBytes+bytes>config.maxPendingBytes)return reject('bus.backpressure');
  const task={event,bytes,recipients:[...subscribers],delivered:false};queue.push(task);pendingBytes+=bytes;
  nextSequence++;
  if(config.maxHistory>0&&bytes<=config.maxHistoryBytes){const item={event,bytes};history.push(item);retained.set(event.id,item);historyBytes+=bytes;
   while(history.length>config.maxHistory||historyBytes>config.maxHistoryBytes){const removed=history.shift();historyBytes-=removed.bytes;retained.delete(removed.event.id);}
  }
  flush();
  return{accepted:true,delivery:task.delivered?'delivered':'queued'};
 }
 function dispose(){
  if(disposed)return;
  disposed=true;for(const record of subscribers){record.active=false;record.listener=null;}
  subscribers.clear();queue.length=0;history.length=0;retained.clear();pendingBytes=0;historyBytes=0;onDiagnostic=null;
 }
 function stats(){return Object.freeze({disposed,subscribers:subscribers.size,pending:queue.length,pendingBytes,history:history.length,historyBytes,nextSequence});}
 return Object.freeze({subscribe,publish,flush,dispose,stats});
}
