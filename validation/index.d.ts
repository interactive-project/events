export interface EventDiagnostic{code:string;path:string;severity:'error';message:string}
export type EventValidationResult={valid:true;diagnostics:[]}|{valid:false;diagnostics:EventDiagnostic[]};
export declare function validateEvent(input:unknown):EventValidationResult;
