/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'
import { RunScriptStepArgs } from 'hooklib'
import { execCpFromPod, execCpToPod, execPodStep } from '../k8s'
import { writeRunScript, sleep, listDirAllCommand } from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'
import { dirname } from 'path'
import * as shlex from 'shlex'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state
): Promise<void> {
  // Write the entrypoint first. This will be later coppied to the workflow pod
  const { entryPoint, entryPointArgs, environmentVariables } = args
  const { containerPath, runnerPath } = writeRunScript(
    args.workingDirectory,
    entryPoint,
    entryPointArgs,
    args.prependPath,
    environmentVariables
  )

  const workdir = dirname(process.env.RUNNER_WORKSPACE as string)
  const runnerTemp = `${workdir}/_temp`
  const containerTemp = '/__w/_temp'
  const containerTempSrc = '/__w/_temp_pre'
  // Ensure base and staging dirs exist before copying
  try {
    await execPodStep(
      [
        'sh',
        '-c',
        'mkdir -p /__w && mkdir -p /__w/_temp && mkdir -p /__w/_temp_pre'
      ],
      state.jobPod,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    core.debug(
      `Failed to create temp dirs in container: ${JSON.stringify(err)}`
    )
  }
  await execCpToPod(state.jobPod, runnerTemp, containerTempSrc)

  // Copy GitHub directories from temp to /github
  // Merge strategy:
  // - Overwrite files in _runner_file_commands
  // - Append files not already present elsewhere
  const mergeCommands = [
    'set -e',
    'mkdir -p /__w/_temp /__w/_temp_pre',
    'SRC=/__w/_temp_pre',
    'DST=/__w/_temp',
    // Overwrite _runner_file_commands
    '[ -d "$SRC/_runner_file_commands" ] && mkdir -p "$DST/_runner_file_commands" && cp -a "$SRC/_runner_file_commands/." "$DST/_runner_file_commands/" || true',
    // Append other files if missing
    'find "$SRC" -type f ! -path "*/_runner_file_commands/*" | while read -r f; do rel=${f#"$SRC/"}; target="$DST/$rel"; dir=$(dirname "$target"); if [ ! -e "$target" ]; then mkdir -p "$dir"; cp -a "$f" "$target"; fi; done'
  ]

  try {
    await execPodStep(
      ['sh', '-c', mergeCommands.join(' && ')],
      state.jobPod,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    core.debug(`Failed to merge temp directories: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to merge temp dirs: ${message}`)
  }

  // Execute the entrypoint script
  args.entryPoint = 'sh'
  args.entryPointArgs = ['-e', containerPath]
  try {
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
    try {
      fs.rmSync(runnerPath, { force: true })
    } catch (removeErr) {
      core.debug(`Failed to remove file ${runnerPath}: ${removeErr}`)
    }
  }

  try {
    core.debug(
      `Copying from job pod '${state.jobPod}' ${containerTemp} to ${runnerTemp}`
    )
    await execCpFromPod(
      state.jobPod,
      `${containerTemp}/_runner_file_commands`,
      `${workdir}/_temp`
    )
  } catch (error) {
    core.warning('Failed to copy _temp from pod')
  }
}
