import { pruneJobs, prunePods, pruneSecrets } from '../k8s'

export async function cleanupJob(): Promise<void> {
  // Jobs own their step pods, so delete them first and let the pod prune
  // mop up anything the garbage collector has not reclaimed yet.
  await pruneJobs()
  await Promise.all([prunePods(), pruneSecrets()])
}
