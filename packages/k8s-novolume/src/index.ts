import * as core from '@actions/core'
import {
  Command,
  getInputFromStdin,
  PrepareJobArgs,
  RunContainerStepArgs,
  RunScriptStepArgs
} from 'hooklib'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from './hooks'
import { isAuthPermissionsOK, namespace, requiredPermissions } from './k8s'

async function run(): Promise<void> {
  try {
    const input = await getInputFromStdin()

    const args = input['args']
    const command = input['command']
    const responseFile = input['responseFile']
    const state = input['state']
    if (!(await isAuthPermissionsOK())) {
      throw new Error(
        `The Service account needs the following permissions ${JSON.stringify(
          requiredPermissions
        )} on the pod resource in the '${namespace()}' namespace. Please contact your self hosted runner administrator.`
      )
    }

    let exitCode = 0
    switch (command) {
      case Command.PrepareJob:
        await prepareJob(args as PrepareJobArgs, responseFile)
        return process.exit(0)
      case Command.CleanupJob:
        await cleanupJob()
        return process.exit(0)
      case Command.RunScriptStep:
        await runScriptStep(args as RunScriptStepArgs, state)
        return process.exit(0)
      case Command.RunContainerStep:
        exitCode = await runContainerStep(args as RunContainerStepArgs)
        return process.exit(exitCode)
      default:
        throw new Error(`Command not recognized: ${command}`)
    }
  } catch (error) {
    core.error(error as Error)
    process.exit(1)
  }
}

void run()
