import { runDockerCommand } from '../utils'
import { getRunnerLabel } from './constants'

export async function networkCreate(networkName): Promise<void> {
  const dockerArgs: string[] = ['network', 'create']
  dockerArgs.push('--label')
  dockerArgs.push(getRunnerLabel())
  dockerArgs.push(networkName)
  await runDockerCommand(dockerArgs)
}

export async function networkRemove(networkName): Promise<void> {
  const dockerArgs: string[] = ['network']
  dockerArgs.push('rm')
  dockerArgs.push(networkName)
  await runDockerCommand(dockerArgs)
}

export async function networkPrune(): Promise<void> {
  const dockerArgs: string[] = ['network']
  dockerArgs.push('prune')
  dockerArgs.push('--force')
  dockerArgs.push(`--filter`)
  dockerArgs.push(`label=${getRunnerLabel()}`)
  await runDockerCommand(dockerArgs)
}
