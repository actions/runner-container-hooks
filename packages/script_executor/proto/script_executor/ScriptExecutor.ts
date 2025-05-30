// Original file: ../proto/script_executor.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { ScriptRequest as _script_executor_ScriptRequest, ScriptRequest__Output as _script_executor_ScriptRequest__Output } from '../script_executor/ScriptRequest';
import type { ScriptResponse as _script_executor_ScriptResponse, ScriptResponse__Output as _script_executor_ScriptResponse__Output } from '../script_executor/ScriptResponse';

export interface ScriptExecutorClient extends grpc.Client {
  ExecuteScript(argument: _script_executor_ScriptRequest, metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientReadableStream<_script_executor_ScriptResponse__Output>;
  ExecuteScript(argument: _script_executor_ScriptRequest, options?: grpc.CallOptions): grpc.ClientReadableStream<_script_executor_ScriptResponse__Output>;
  executeScript(argument: _script_executor_ScriptRequest, metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientReadableStream<_script_executor_ScriptResponse__Output>;
  executeScript(argument: _script_executor_ScriptRequest, options?: grpc.CallOptions): grpc.ClientReadableStream<_script_executor_ScriptResponse__Output>;
  
}

export interface ScriptExecutorHandlers extends grpc.UntypedServiceImplementation {
  ExecuteScript: grpc.handleServerStreamingCall<_script_executor_ScriptRequest__Output, _script_executor_ScriptResponse>;
  
}

export interface ScriptExecutorDefinition extends grpc.ServiceDefinition {
  ExecuteScript: MethodDefinition<_script_executor_ScriptRequest, _script_executor_ScriptResponse, _script_executor_ScriptRequest__Output, _script_executor_ScriptResponse__Output>
}
