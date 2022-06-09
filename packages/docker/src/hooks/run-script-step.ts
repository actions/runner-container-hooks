import { RunScriptStepArgs } from 'hooklib/lib'
import { containerExecStep } from '../dockerCommands'
import { runWithEnvironment } from '../utils'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state
): Promise<void> {
  const containerExecStepCallback = containerExecStep.bind(
    null,
    args,
    state.container
  )
  await runWithEnvironment<void>(
    containerExecStepCallback,
    args.environmentVariables
  )
}
