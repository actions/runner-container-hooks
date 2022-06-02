import { RunScriptStepArgs } from 'hooklib/lib'
import { containerExecStep } from '../dockerCommands'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state
): Promise<void> {
  await containerExecStep(args, state.container)
}
