import * as core from '@actions/core'
import {
  Command,
  getInputFromStdin,
  PrepareJobArgs,
  RunContainerStepArgs,
  RunScriptStepArgs
} from 'hooklib/lib'
import { exit } from 'process'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from './hooks'
import { checkEnvironment } from './utils'

async function run(): Promise<void> {
  try {
    checkEnvironment()
    const input = await getInputFromStdin()

    const args = input['args']
    const command = input['command']
    const responseFile = input['responseFile']
    const state = input['state']
    switch (command) {
      case Command.PrepareJob:
        await prepareJob(args as PrepareJobArgs, responseFile)
        return exit(0)
      case Command.CleanupJob:
        await cleanupJob()
        return exit(0)
      case Command.RunScriptStep:
        await runScriptStep(args as RunScriptStepArgs, state)
        return exit(0)
      case Command.RunContainerStep:
        await runContainerStep(args as RunContainerStepArgs, state)
        return exit(0)
      default:
        throw new Error(`Command not recognized: ${command}`)
    }
  } catch (error) {
    core.error(`${error}`)
    exit(1)
  }
}

void run()
