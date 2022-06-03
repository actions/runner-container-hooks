import {
  containerNetworkPrune,
  containerPrune
} from '../dockerCommands/container'

export async function cleanupJob(): Promise<void> {
  await containerPrune()
  await containerNetworkPrune()
}
