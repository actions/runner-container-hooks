import * as core from '@actions/core'
import { Command, getInputFromStdin, prepareJobArgs } from 'hooklib'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from './hooks'
import { isAuthPermissionsOK, namespace, requiredPermissions } from './k8s'

async function run(): Promise<void> {
  const input = await getInputFromStdin()

  const args = input['args']
  const command = input['command']
  const responseFile = input['responseFile']
  const state = input['state']

  let exitCode = 0
  try {
    if (!(await isAuthPermissionsOK())) {
      throw new Error(
        `The Service account needs the following permissions ${JSON.stringify(
          requiredPermissions
        )} on the pod resource in the '${namespace()}' namespace. Please contact your self hosted runner administrator.`
      )
    }
    switch (command) {
      case Command.PrepareJob:
        await prepareJob(args as prepareJobArgs, responseFile)
        break
      case Command.CleanupJob:
        await cleanupJob()
        break
      case Command.RunScriptStep:
        await runScriptStep(args, state, null)
        break
      case Command.RunContainerStep:
        exitCode = await runContainerStep(args)
        break
      case Command.runContainerStep:
      default:
        throw new Error(`Command not recognized: ${command}`)
    }
  } catch (error) {
    core.error(error as Error)
    exitCode = 1
  }
  process.exitCode = exitCode
}

void run()
