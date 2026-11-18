import * as fs from 'fs'
import * as core from '@actions/core'
import { RunScriptStepArgs } from 'hooklib'
import { execCpFromPod, execCpToPod, execPodStep } from '../k8s'
import { formatError, writeRunScript } from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'
import { basename, dirname, isAbsolute, join, resolve } from 'path'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state: { jobPod?: unknown } | undefined
): Promise<void> {
  if (!state || typeof state.jobPod !== 'string' || !state.jobPod) {
    throw new Error('Job pod is missing from hook state')
  }
  const runnerWorkspace = process.env.RUNNER_WORKSPACE
  if (!runnerWorkspace || !isAbsolute(runnerWorkspace)) {
    throw new Error('RUNNER_WORKSPACE must be an absolute path')
  }
  const workspace = resolve(runnerWorkspace)
  const workdir = dirname(workspace)
  if (workdir === workspace) {
    throw new Error('RUNNER_WORKSPACE must not be the filesystem root')
  }

  // Write the entrypoint first. This will be later coppied to the workflow pod
  const { entryPoint, entryPointArgs, environmentVariables } = args
  const { containerPath, runnerPath } = writeRunScript(
    args.workingDirectory,
    entryPoint,
    entryPointArgs,
    args.prependPath,
    environmentVariables
  )

  const runnerTemp = `${workdir}/_temp`
  const containerTemp = '/__w/_temp'
  const containerTempSrc = '/__w/_temp_pre'
  // Ensure base and staging dirs exist before copying
  await execPodStep(
    ['sh', '-c', 'mkdir -p /__w/_temp /__w/_temp_pre /__w/_actions'],
    state.jobPod,
    JOB_CONTAINER_NAME
  )
  const runnerActions = join(workdir, '_actions')
  if (fs.existsSync(runnerActions)) {
    // Local composites can cause the runner to download actions after prepare_job.
    await execCpToPod(state.jobPod, runnerActions, '/__w/_actions')
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
    'cp -a "$SRC/_runner_file_commands/." "$DST/_runner_file_commands"',
    `find "$SRC" -type f ! -path "*/_runner_file_commands/*" -exec sh -c '
    rel="\${1#$2/}"
    target="$3/$rel"
    mkdir -p "$(dirname "$target")"
    cp -a "$1" "$target"
  ' _ {} "$SRC" "$DST" \\;`,
    // Remove _temp_pre after merging
    'rm -rf /__w/_temp_pre'
  ]

  try {
    await execPodStep(
      ['sh', '-c', mergeCommands.join(' && ')],
      state.jobPod,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    const message = formatError(err)
    core.debug(`Failed to merge temp directories: ${message}`)
    throw new Error(`failed to merge temp dirs: ${message}`)
  }

  // Execute the entrypoint script
  args.entryPoint = 'sh'
  args.entryPointArgs = ['-e', containerPath]
  let stepError: Error | undefined
  try {
    await execPodStep(
      [args.entryPoint, ...args.entryPointArgs],
      state.jobPod,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    const message = formatError(err)
    core.debug(`execPodStep failed: ${message}`)
    stepError = new Error(`failed to run script step: ${message}`)
  } finally {
    try {
      fs.rmSync(runnerPath, { force: true })
    } catch (removeErr) {
      core.debug(`Failed to remove file ${runnerPath}: ${removeErr}`)
    }
  }

  try {
    // The runner loads local action manifests outside the job pod.
    await syncWorkspace(state.jobPod, workspace, workdir)
    core.debug(
      `Copying from job pod '${state.jobPod}' ${containerTemp} to ${runnerTemp}`
    )
    await execCpFromPod(
      state.jobPod,
      `${containerTemp}/_runner_file_commands`,
      `${workdir}/_temp`
    )
  } catch (error) {
    const message = `failed to synchronize files from job pod: ${formatError(error)}`
    throw new Error(stepError ? `${stepError.message}; ${message}` : message)
  }
  if (stepError) {
    throw stepError
  }
}

async function syncWorkspace(
  podName: string,
  workspace: string,
  workdir: string
): Promise<void> {
  const staging = await fs.promises.mkdtemp(join(workdir, '.workspace-'))
  try {
    const name = basename(workspace)
    await execCpFromPod(podName, `/__w/${name}`, staging)
    const stagedWorkspace = join(staging, name)
    if (!(await fs.promises.lstat(stagedWorkspace)).isDirectory()) {
      throw new Error(
        'Copied workspace must be a directory, not a symlink or file'
      )
    }
    // Replace instead of merging to propagate deletions and avoid old symlinks.
    await fs.promises.rm(workspace, { recursive: true, force: true })
    await fs.promises.rename(stagedWorkspace, workspace)
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true })
  }
}
