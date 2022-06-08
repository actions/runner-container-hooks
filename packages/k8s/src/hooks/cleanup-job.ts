import { pruneSecrets, prunePods } from '../k8s'

export async function cleanupJob(): Promise<void> {
  await prunePods()
  await pruneSecrets()
}
