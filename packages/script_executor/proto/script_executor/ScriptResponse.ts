// Original file: ../proto/script_executor.proto

export interface ScriptResponse {
  output?: string
  error?: string
  code?: number
  _output?: 'output'
  _error?: 'error'
  _code?: 'code'
}

export interface ScriptResponse__Output {
  output?: string
  error?: string
  code?: number
  _output?: 'output'
  _error?: 'error'
  _code?: 'code'
}
