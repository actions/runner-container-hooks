import { RunScriptStepArgs } from 'hooklib'
import { containerExecStep } from '../dockerCommands'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state
): Promise<void> {
  await containerExecStep(args, state.container)
}
