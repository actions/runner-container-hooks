import * as k8s from '@kubernetes/client-node'

const kc = new k8s.KubeConfig()
kc.loadFromDefault()
const k8sApi = kc.makeApiClient(k8s.StorageV1Api)

describe('RWX Test Contract Demo', () => {
  describe('RWX volume tests', () => {
    it('should have at least one available storage class', async () => {
      const list = await k8sApi.listStorageClass()
      expect(list.items.length).toBeGreaterThan(0)
    })

    it('should have at least one default storage class in cluster', async () => {
      const list = await k8sApi.listStorageClass()
      const hasDefault = list.items.some(sc => {
        const annotations = sc.metadata?.annotations || {}
        return (
          annotations['storageclass.kubernetes.io/is-default-class'] ===
            'true' ||
          annotations['storageclass.beta.kubernetes.io/is-default-class'] ===
            'true'
        )
      })
      expect(hasDefault).toBe(true)
    })
  })
})
