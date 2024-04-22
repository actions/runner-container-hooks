/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'
import { RunScriptStepArgs } from 'hooklib'
import { execPodStep, copyToPod } from '../k8s'
import { writeEntryPointScript } from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'
import { listFilesSync } from './run-container-step'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
  core.debug(
    `!!!!!!!!!!!!!! Running script step with args: ${JSON.stringify(args)}`
  )
  listFilesSync()

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
    core.info('Starting script step')
    listFilesSync()

    core.info(
      `Copying runner script to pod from ${runnerPath} to ${containerPath}`
    )
    await copyToPod(state.jobPod, JOB_CONTAINER_NAME, runnerPath, containerPath)
    // core.info('Runner script copied to pod. Waiting for 100s...')
    await new Promise(resolve => setTimeout(resolve, 900000))

    core.info('! Running script by execPodStep')
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

// async function testCopy(pod, sourcePath, containerPath): Promise<void> {
//   try {
//     core.info('Copying missing file')
//     await copyToPod(pod, JOB_CONTAINER_NAME, '/missing/file', containerPath)
//   } catch (err) {
//     core.info('Copy testing ')
//     core.info(`Error: ${err}`)
//   }

//   try {
//     core.info('Copying to root')
//     await copyToPod(pod, JOB_CONTAINER_NAME, sourcePath, '/')
//   } catch (err) {
//     core.info('Copy testing ')
//     core.info(`Error: ${err}`)
//   }

//   try {
//     core.info('Copying to wrong dir')
//     await copyToPod(pod, JOB_CONTAINER_NAME, sourcePath, '/wrong/dir')
//   } catch (err) {
//     core.info('Copy testing ')
//     core.info(`Error: ${err}`)
//   }

//   try {
//     core.info('Copying to wrong pod')
//     await copyToPod('pod', JOB_CONTAINER_NAME, sourcePath, containerPath)
//   } catch (err) {
//     core.info('Copy testing ')
//     core.info(`Error: ${err}`)
//   }
//   try {
//     core.info('Copying to wrong container')
//     await copyToPod(pod, 'sdfsdfds', sourcePath, '/wrong/dir')
//   } catch (err) {
//     core.info('Copy testing ')
//     core.info(`Error: ${err}`)
//   }
// }
