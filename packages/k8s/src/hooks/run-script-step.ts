/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'

import { RunScriptStepArgs } from 'hooklib'
import {
  BackOffManager,
  execPodStep,
  getRootCertClientCertAndKey
} from '../k8s'
import {
  getEntryPointScriptContent,
  runScriptByGrpc,
  useScriptExecutor,
  writeEntryPointScript
} from '../k8s/utils'
import {
  getServiceName,
  GRPC_SCRIPT_EXECUTOR_PORT,
  JOB_CONTAINER_NAME
} from './constants'

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

  core.info('using script executor')
  const rootCertClientAndKey = await getRootCertClientCertAndKey()
  core.debug('successfully retrieved root cert, client and key')

  // This will throw after retrying with back off for up to 60s.
  const backOffmanager = new BackOffManager(60)
  while (true) {
    try {
      await runScriptByGrpc(
        scriptContent,
        rootCertClientAndKey.caCertAndkey.cert,
        rootCertClientAndKey.clientCertAndKey.cert,
        rootCertClientAndKey.clientCertAndKey.privateKey,
        getServiceName(),
        GRPC_SCRIPT_EXECUTOR_PORT
      )
      break
    } catch (err) {
      core.debug(
        `ScriptExecutorError when trying to execute: ${JSON.stringify(err)}`
      )
      const message = (err as any)?.response?.body?.message || err
      if (String(message).includes('ECONNREFUSED')) {
        // Retry for 60s since the service may not be established.
        core.debug(`Retrying execution for ECONNREFUSED.`)
        await backOffmanager.backOff()
      } else {
        break
      }
    }
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
