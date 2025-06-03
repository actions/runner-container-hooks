import type * as grpc from '@grpc/grpc-js'
import type { MessageTypeDefinition } from '@grpc/proto-loader'

import type {
  ScriptExecutorClient as _script_executor_ScriptExecutorClient,
  ScriptExecutorDefinition as _script_executor_ScriptExecutorDefinition
} from './script_executor/ScriptExecutor'

type SubtypeConstructor<
  Constructor extends new (...args: any) => any,
  Subtype
> = {
  new (...args: ConstructorParameters<Constructor>): Subtype
}

export interface ProtoGrpcType {
  script_executor: {
    ScriptExecutor: SubtypeConstructor<
      typeof grpc.Client,
      _script_executor_ScriptExecutorClient
    > & { service: _script_executor_ScriptExecutorDefinition }
    ScriptRequest: MessageTypeDefinition
    ScriptResponse: MessageTypeDefinition
  }
}
