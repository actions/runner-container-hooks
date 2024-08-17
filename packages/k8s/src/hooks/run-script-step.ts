/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'
import { dirname } from 'path'
import { RunScriptStepArgs } from 'hooklib'
import { execPodStep, copyToPod } from '../k8s'
import { writeEntryPointScript } from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
  core.debug(
    `!!!!!!!!!!!!!! Running script step with args: ${JSON.stringify(args)}`
  )

  const { entryPoint, entryPointArgs, environmentVariables } = args
  const { containerPath, runnerPath } = writeEntryPointScript(
    args.workingDirectory,
    entryPoint,
    entryPointArgs,
    args.prependPath,
    environmentVariables
  )

  args.entryPoint = 'sh'
  args.entryPointArgs = ['-e', containerPath]
  try {
    core.debug('Starting script step')

    await copyToPod(
      state.jobPod,
      JOB_CONTAINER_NAME,
      '/home/runner/_work/_temp',
      '/__w/'
    )

    //await new Promise(resolve => setTimeout(resolve, 600000))

    core.debug('! Running script by execPodStep')
    await execPodStep(
      [args.entryPoint, ...args.entryPointArgs],
      state.jobPod,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    core.debug(`execPodStep failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step: ${message}`)
  } finally {
    fs.rmSync(runnerPath)
  }
}
