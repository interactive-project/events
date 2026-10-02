import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {validateEvent} from '../validation/index.js';
import {eventTypes,eventVersion,timestampUnit} from '../index.js';
const require=createRequire(import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const spec=JSON.parse(readFileSync(require.resolve('@interactive-project/protocol/schemas/activity-spec.v1.schema.json'))),interop=JSON.parse(readFileSync(require.resolve('@interactive-project/protocol/schemas/interoperability.v1.schema.json'))),schema=read('../schemas/event.v1.schema.json');
const ajv=new Ajv2020({strict:true,allErrors:true});addFormats(ajv);ajv.addSchema(spec);ajv.addSchema(interop);const structural=ajv.compile(schema),manifest=read('../fixtures/conformance.json');
for(const entry of manifest){
 const event=read('../fixtures/'+entry.file),before=JSON.stringify(event),result=validateEvent(event);
 assert.equal(result.valid,entry.valid,entry.file);assert.equal(JSON.stringify(event),before);
 assert.equal(structural(event),entry.valid||entry.structural===false,entry.file+': structure');
 if(entry.valid)assert.deepEqual(JSON.parse(JSON.stringify(event)),event);
}
const catalog=read('../catalogs/events.v1.json');assert.equal(eventVersion,'1.0.0');assert.equal(timestampUnit,'unix-milliseconds');
assert(Object.isFrozen(eventTypes));assert.deepEqual(catalog.events.map(e=>e.type),eventTypes);assert.deepEqual(schema.$defs.envelope.properties.type.enum,eventTypes);
for(const entry of catalog.events){const branch=schema.allOf[1].oneOf.find(b=>b.properties.type.const===entry.type);assert(branch);assert.deepEqual(entry.payloadFields,Object.keys(branch.properties.payload.properties));assert.equal(branch.required.includes('attemptId'),entry.requiresAttempt);assert.equal(branch.properties.activityType?.const??null,entry.activityType);}
const event=read('../fixtures/valid/activity.started.json');event.timestamp=0;event.sequence=9007199254740991;assert(validateEvent(event).valid);event.sequence++;assert(!validateEvent(event).valid);
event.sequence=0;event.extensions={'org.example/future':{opaque:[null,false,'retained']}};assert(validateEvent(event).valid);assert.deepEqual(JSON.parse(JSON.stringify(event)).extensions,event.extensions);
event.extensions['org.example/future']='x'.repeat(4001);assert.equal(validateEvent(event).diagnostics[0].code,'generation.maxStringLength');
const cycle=read('../fixtures/valid/activity.started.json');cycle.payload.self=cycle;assert.equal(validateEvent(cycle).diagnostics[0].code,'input.cycle');
const getter={};Object.defineProperty(getter,'id',{enumerable:true,get(){throw Error('Getter called');}});assert.equal(validateEvent(getter).diagnostics[0].code,'input.nonJson');
const retry=read('../fixtures/valid/activity.started.json'),copy=JSON.parse(JSON.stringify(retry));assert.equal(copy.id,retry.id);assert.equal(copy.sourceId,retry.sourceId);assert.equal(copy.sequence,retry.sequence);
const unrelated=read('../fixtures/valid/activity.started.json');unrelated.timestamp=1;assert(validateEvent(unrelated).valid,'No global clock or sequence state assumed by the stateless validator');
const badCausation=read('../fixtures/invalid/self-causation.json');assert.equal(validateEvent(badCausation).diagnostics[0].code,'event.causation');
const badIdentity=read('../fixtures/invalid/result-identity.json');assert.equal(validateEvent(badIdentity).diagnostics[0].code,'event.identity');
const ts=(await import('typescript')).default,program=ts.createProgram([new URL('./type-consumer.mts',import.meta.url).pathname],{strict:true,noEmit:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,lib:['lib.es2022.d.ts']});
const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
const checker=program.getTypeChecker(),source=program.getSourceFiles().find(s=>s.fileName.endsWith('/types/events.d.ts')),declarations=new Map(source.statements.filter(s=>s.name).map(s=>[s.name.text,s]));
function resolve(shape,root){if(!shape.$ref)return[shape,root];const ref=shape.$ref;root=ref.startsWith('#')?root:ref.startsWith(spec.$id)?spec:interop;const pointer=ref.split('#')[1].split('/').slice(1);for(const key of pointer)root=root;let value=root;for(const key of pointer)value=value[key];return[value,root];}
function compare(type,shape,root=schema){
 [shape,root]=resolve(shape,root);
 if(shape.oneOf){assert(type.isUnion());assert.equal(type.types.length,shape.oneOf.length);for(const member of type.types){const status=checker.getPropertyOfType(member,'status');const literal=checker.getTypeOfSymbolAtLocation(status,source).value;const candidate=shape.oneOf.find(s=>resolve(s,root)[0].properties.status.const===literal);assert(candidate);compare(member,candidate,root);}return;}
 if(shape.properties){const props=checker.getPropertiesOfType(type);assert.deepEqual(props.map(p=>p.name).sort(),Object.keys(shape.properties).sort());for(const prop of props){assert.equal(!(prop.flags&ts.SymbolFlags.Optional),(shape.required??[]).includes(prop.name));compare(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(prop,source)),shape.properties[prop.name],root);}}
 else if(shape.enum||shape.const!==undefined){const values=type.isUnion()?type.types.map(t=>t.value):[type.value];assert.deepEqual(values.sort(),(shape.enum??[shape.const]).slice().sort());}
 else if(Array.isArray(shape.type))assert.equal(checker.typeToString(type),'JsonValue');
 else if(shape.type==='object')compare(checker.getIndexTypeOfType(type,ts.IndexKind.String),shape.additionalProperties,root);
 else if(shape.type==='array')compare(checker.getIndexTypeOfType(type,ts.IndexKind.Number),shape.items,root);
 else assert.equal(checker.typeToString(type),shape.type==='integer'?'number':shape.type);
}
const identityShape={...schema.$defs.envelope,properties:{...schema.$defs.envelope.properties}};delete identityShape.properties.type;delete identityShape.properties.payload;identityShape.required=identityShape.required.filter(k=>!['type','payload'].includes(k));
compare(checker.getTypeAtLocation(declarations.get('EventIdentity')),identityShape);
const payloadType=checker.getTypeAtLocation(declarations.get('EventPayloads'));assert.deepEqual(checker.getPropertiesOfType(payloadType).map(p=>p.name).sort(),eventTypes.slice().sort());
for(const branch of schema.allOf[1].oneOf){const prop=checker.getPropertyOfType(payloadType,branch.properties.type.const);compare(checker.getTypeOfSymbolAtLocation(prop,source),branch.properties.payload);}
console.log('Events: '+manifest.length+' JS fixtures, 19 typed catalog entries, exact protocol identity/result alignment, source correlation boundaries and headless types passed.');
