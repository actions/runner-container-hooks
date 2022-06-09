import { RunContainerStepArgs } from 'hooklib/lib'
import { v4 as uuidv4 } from 'uuid'
import {
  containerBuild,
  containerPull,
  containerRun,
  registryLogin,
  registryLogout
} from '../dockerCommands'
import { getRunnerLabel } from '../dockerCommands/constants'
import { runWithEnvironment } from '../utils'

export async function runContainerStep(
  args: RunContainerStepArgs,
  state
): Promise<void> {
  const tag = generateBuildTag() // for docker build
  if (args.image) {
    const configLocation = await registryLogin(args.registry)
    try {
      await containerPull(args.image, configLocation)
    } finally {
      await registryLogout(configLocation)
    }
  } else if (args.dockerfile) {
    await containerBuild(args, tag)
    args.image = tag
  } else {
    throw new Error(
      'run container step should have image or dockerfile fields specified'
    )
  }

  const runContainerCallback = containerRun.bind(
    null,
    args,
    tag.split(':')[1],
    state?.network
  )
  await runWithEnvironment<void>(
    runContainerCallback,
    args.environmentVariables
  )
}

function generateBuildTag(): string {
  return `${getRunnerLabel()}:${uuidv4().substring(0, 6)}`
}
