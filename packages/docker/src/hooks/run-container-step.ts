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
  // container will get pruned at the end of the job based on the label, no need to cleanup here
  await containerRun(args, tag.split(':')[1], state?.network)
}

function generateBuildTag(): string {
  return `${getRunnerLabel()}:${uuidv4().substring(0, 6)}`
}
