/* eslint-disable @typescript-eslint/no-unused-vars */
import { RunScriptStepArgs } from 'hooklib'
import { execPodStep } from '../k8s'
import { getJobPodName, JOB_CONTAINER_NAME } from './constants'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
  const cb = new CommandsBuilder(
    args.entryPoint,
    args.entryPointArgs,
    args.environmentVariables
  )
  await execPodStep(cb.command, getJobPodName(), JOB_CONTAINER_NAME)
}

class CommandsBuilder {
  constructor(
    private entryPoint: string,
    private entryPointArgs: string[],
    private environmentVariables: { [key: string]: string }
  ) {}

  get command(): string[] {
    const envCommands: string[] = []
    if (
      this.environmentVariables &&
      Object.entries(this.environmentVariables).length
    ) {
      for (const [key, value] of Object.entries(this.environmentVariables)) {
        envCommands.push(`${key}=${value}`)
      }
    }
    return ['env', ...envCommands, this.entryPoint, ...this.entryPointArgs]
  }
}
