export interface ExecResponse {
  code?: number
}

export function requireExecExitCode(response: ExecResponse): number {
  const { code } = response
  if (typeof code !== 'number' || !Number.isInteger(code)) {
    throw new Error('execPodStep completed without an exit code')
  }
  return code
}
