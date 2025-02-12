/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'
import { RunScriptStepArgs } from 'hooklib'
import { execPodStep } from '../k8s'
import { rpcPodStep } from '../k8s/rpc'
import { writeEntryPointScript } from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
  const { entryPoint, entryPointArgs, environmentVariables } = args
  const { containerPath, runnerPath, id } = writeEntryPointScript(
    args.workingDirectory,
    entryPoint,
    entryPointArgs,
    args.prependPath,
    environmentVariables
  )

  args.entryPoint = 'sh'
  args.entryPointArgs = ['-e', containerPath]
  try {
    // FIXME: do we need to keep the original, condition on some env var or something?
    // await execPodStep(
    //   [args.entryPoint, ...args.entryPointArgs],
    //   state.jobPod,
    //   JOB_CONTAINER_NAME
    // )
    await rpcPodStep(
      id,
      containerPath,
      state.jobService,
    )
  } catch (err) {
    core.debug(`execPodStep failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step (id ${id}): ${message}`)
  } finally {
    fs.rmSync(runnerPath)
  }
}
