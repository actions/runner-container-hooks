import {
  containerBuild,
  registryLogin,
  registryLogout,
  containerPull,
  containerRun
} from '../dockerCommands'
import { v4 as uuidv4 } from 'uuid'
import * as core from '@actions/core'
import { RunContainerStepArgs } from 'hooklib/lib'
import { getRunnerLabel } from '../dockerCommands/constants'

export async function runContainerStep(
  args: RunContainerStepArgs,
  state
): Promise<void> {
  const tag = generateBuildTag() // for docker build
  if (!args.image) {
    core.error('expected an image')
  } else {
    if (args.dockerfile) {
      await containerBuild(args, tag)
      args.image = tag
    } else {
      const configLocation = await registryLogin(args)
      try {
        await containerPull(args.image, configLocation)
      } finally {
        await registryLogout(configLocation)
      }
    }
  }
  // container will get pruned at the end of the job based on the label, no need to cleanup here
  await containerRun(args, tag.split(':')[1], state.network)
}

function generateBuildTag(): string {
  return `${getRunnerLabel()}:${uuidv4().substring(0, 6)}`
}
