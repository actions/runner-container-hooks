import {
  containerRemove,
  containerNetworkRemove
} from '../dockerCommands/container'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cleanupJob(args, state, responseFile): Promise<void> {
  const containerIds: string[] = []
  if (state?.container) {
    containerIds.push(state.container)
  }
  if (state?.services) {
    containerIds.push(state.services)
  }
  if (containerIds.length > 0) {
    await containerRemove(containerIds)
  }
  if (state.network) {
    await containerNetworkRemove(state.network)
  }
}
