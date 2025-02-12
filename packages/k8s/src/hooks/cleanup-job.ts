import { prunePods, pruneServices, pruneSecrets } from '../k8s'

export async function cleanupJob(): Promise<void> {
  await Promise.all([prunePods(), pruneServices(), pruneSecrets()])
}
