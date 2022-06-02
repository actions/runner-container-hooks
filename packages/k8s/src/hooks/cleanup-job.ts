import { podPrune } from '../k8s'

export async function cleanupJob(): Promise<void> {
  await podPrune()
}
