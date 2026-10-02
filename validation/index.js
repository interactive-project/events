import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {copyGeneratedJson} from '@interactive-project/protocol/generation/json';
const require=createRequire(import.meta.url),ajv=new Ajv2020({strict:true,allErrors:true,ownProperties:true});addFormats(ajv);
for(const name of ['activity-spec','interoperability'])ajv.addSchema(JSON.parse(readFileSync(require.resolve('@interactive-project/protocol/schemas/'+name+'.v1.schema.json'))));
const schema=JSON.parse(readFileSync(new URL('../schemas/event.v1.schema.json',import.meta.url))),validate=ajv.compile(schema);
const escape=text=>text.replace(/~/g,'~0').replace(/\//g,'~1'),diag=(code,path,message)=>({code,path,severity:'error',message});
export function validateEvent(input){
 const prepared=copyGeneratedJson(input,{maxBytes:1048576,maxDepth:32,maxCollectionSize:1000,maxStringLength:4000,maxNodes:10000});
 if(!prepared.valid)return{valid:false,diagnostics:prepared.diagnostics};
 const event=prepared.value;
 if(!validate(event)){
 const errors=validate.errors.map(e=>diag('event.schema',e.instancePath+(e.params.missingProperty!==undefined?'/'+escape(e.params.missingProperty):e.params.additionalProperty!==undefined?'/'+escape(e.params.additionalProperty):''),'The event violates its exact versioned schema.'));
 return{valid:false,diagnostics:[...new Map(errors.map(e=>[JSON.stringify(e),e])).values()]};
 }
 const diagnostics=[];
 if(event.causationEventId===event.id)diagnostics.push(diag('event.causation','/causationEventId','An event cannot directly cause itself.'));
 if(event.type==='interactive-project/activity.interacted'&&event.causationActionId!==undefined&&event.causationActionId!==event.payload.actionId)diagnostics.push(diag('event.causation','/causationActionId','The interaction causation must match its action.'));
 if(event.type==='interactive-project/activity.completed'){
 const result=event.payload.result;
 for(const key of ['activityId','sessionId','attemptId'])if(result[key]!==event[key])diagnostics.push(diag('event.identity','/payload/result/'+key,'The result must match its event identity.'));
 }
 return diagnostics.length?{valid:false,diagnostics}:{valid:true,diagnostics:[]};
}
