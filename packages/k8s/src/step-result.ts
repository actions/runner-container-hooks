import { Command, HookData, writeToResponseFile } from 'hooklib'

// A successful hook invocation and a successful workload are different things.
// Never signal hook success for a failed workload to an older runner, which
// ignores response.exitCode. A response-write failure must fail the hook too.
export function finishStep(input: HookData, exitCode: number): number {
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new Error('Invalid workload exit code')
  }
  if (
    input.command !== Command.RunScriptStep &&
    input.command !== Command.RunContainerStep
  ) {
    throw new Error('Workload exit codes are only valid for step hooks')
  }
  if (input.supportsStepExitCode !== true) return exitCode
  writeToResponseFile(input.responseFile, { exitCode })
  return 0
}
