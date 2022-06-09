import { Command, getInputFromStdin, prepareJobArgs } from 'hooklib'
import * as core from '@actions/core'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from './hooks'

async function run(): Promise<void> {
  const input = await getInputFromStdin()

  const args = input['args']
  const command = input['command']
  const responseFile = input['responseFile']
  const state = input['state']

  let exitCode = 0
  try {
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
    core.error(JSON.stringify(error))
    exitCode = 1
  }
  process.exitCode = exitCode
}

void run()
