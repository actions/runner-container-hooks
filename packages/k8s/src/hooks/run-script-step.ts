/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'

import { RunScriptStepArgs } from 'hooklib'
import { execPodStep, getPodStatus, getRootCertClientCertAndKey } from '../k8s'
import {
  fixArgs,
  getEntryPointScriptContent,
  runScriptByGrpc,
  useScriptExecutor,
  writeEntryPointScript
} from '../k8s/utils'
import { GRPC_SCRIPT_EXECUTOR_PORT, JOB_CONTAINER_NAME } from './constants'

async function runScriptStepWithGRPC(
  args: RunScriptStepArgs,
  state
): Promise<void> {
  const { entryPoint, entryPointArgs, environmentVariables } = args
  const scriptContent = getEntryPointScriptContent(
    args.workingDirectory,
    entryPoint,
    entryPointArgs,
    args.prependPath,
    environmentVariables
  )

  try {
    const podName = state.jobPod
    core.info('using script executor')

    const status = await getPodStatus(podName)
    if (status?.phase === 'Succeeded') {
      throw new Error(`Failed to get pod ${podName} status`)
    }
    if (status?.podIP === undefined) {
      throw new Error(`Failed to get pod ${podName} IP`)
    }

    const rootCertClientAndKey = await getRootCertClientCertAndKey()
    core.debug('successfully retrieved root cert, client and key')
    await runScriptByGrpc(
      scriptContent,
      rootCertClientAndKey.caCertAndkey.cert,
      rootCertClientAndKey.clientCertAndKey.cert,
      rootCertClientAndKey.clientCertAndKey.privateKey,
      status.podIP,
      GRPC_SCRIPT_EXECUTOR_PORT
    )
  } catch (err) {
    core.error(`ScriptExecutorError failure: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step: ${message}`)
  }
}

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
  if (useScriptExecutor()) {
    return runScriptStepWithGRPC(args, state)
  }

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
  const podName = state.jobPod
  try {
    core.info('using exec pod step')
    await execPodStep(
      [args.entryPoint, ...args.entryPointArgs],
      podName,
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
