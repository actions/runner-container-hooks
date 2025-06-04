/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'
import * as protoLoader from '@grpc/proto-loader'
import * as grpc from '@grpc/grpc-js'

import { RunScriptStepArgs } from 'hooklib'
import { execPodStep, getPodStatus } from '../k8s'
import {
  fixArgs,
  sleep,
  useScriptExecutor,
  writeEntryPointScript
} from '../k8s/utils'
import { GRPC_SCRIPT_EXECUTOR_PORT, JOB_CONTAINER_NAME } from './constants'
import { join } from 'path'

const PROTO_PATH = join(__dirname, './proto/script_executor.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
})
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const scriptExecutor = protoDescriptor.script_executor

/**
 * Invoke GRPC server at ip_address:grpc_port to run a command.
 * Stream output and error from the command to the console.
 */
export async function runScriptByGrpc(
  command: string,
  ip: string,
  grpc_port = GRPC_SCRIPT_EXECUTOR_PORT
): Promise<void> {
  const client = new scriptExecutor.ScriptExecutor(
    `${ip}:${grpc_port}`,
    // TODO(quoct): Use mTLS with certificates here.
    grpc.credentials.createInsecure(),
    {
      // Ping the server every 10 seconds to ensure the connection is still active
      'grpc.keepalive_time_ms': 10_000,
      // Wait 5 seconds for the ping ack before assuming the connection is dead
      'grpc.keepalive_timeout_ms': 5_000,
      // send pings even without active streams
      'grpc.keepalive_permit_without_calls': 1
    }
  )

  // TODO(quoct): Add logic to prevent duplicate execution using the `id` field.
  const call = client.executeScript({ script: command })
  await new Promise<void>(async function (resolve, reject) {
    let exitCode = -1
    call.on('data', (response: any) => {
      if (response.hasOwnProperty('code')) {
        exitCode = response.code
      }
      if (response.hasOwnProperty('output')) {
        process.stdout.write(response.output)
      }
      if (response.hasOwnProperty('error')) {
        process.stderr.write(response.error)
      }
    })

    call.on('end', async () => {
      // Half a second wait in case the data event with the exit code did not get triggered yet.
      await sleep(500)
      process.stdout.write(`Job exit code is ${exitCode}.`)
      if (exitCode === 0) {
        resolve()
      } else {
        reject(new Error(`Job failed with exit code ${exitCode}.`))
      }
    })

    call.on('error', (err: any) => {
      const errorMessage = `Error execing ${command}: ${err}`
      process.stdout.write(errorMessage)
      reject(new Error(errorMessage))
    })
  })
}

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
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
    if (useScriptExecutor()) {
      const command = fixArgs([args.entryPoint, ...args.entryPointArgs]).join(
        ' '
      )
      core.debug(`exec command ${command}`)

      const status = await getPodStatus(podName)
      if (status?.phase === 'Succeeded') {
        throw new Error(`Failed to get pod ${podName} status`)
      }
      if (status?.podIP === undefined) {
        throw new Error(`Failed to get pod ${podName} IP`)
      }

      await runScriptByGrpc(command, status.podIP)
    } else {
      await execPodStep(
        [args.entryPoint, ...args.entryPointArgs],
        podName,
        JOB_CONTAINER_NAME
      )
    }
  } catch (err) {
    core.debug(`execPodStep failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step: ${message}`)
  } finally {
    fs.rmSync(runnerPath)
  }
}
