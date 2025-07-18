import { prunePods, pruneSecrets, pruneServices } from '../k8s'

export async function cleanupJob(): Promise<void> {
  await Promise.all([prunePods(), pruneSecrets(), pruneServices()])
}
