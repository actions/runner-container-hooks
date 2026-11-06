import { pruneJobs, prunePods, pruneSecrets } from '../k8s'

export async function cleanupJob(): Promise<void> {
  // Stop Job controllers and their pods before pruning standalone pods.
  await pruneJobs()
  await Promise.all([prunePods(), pruneSecrets()])
}
