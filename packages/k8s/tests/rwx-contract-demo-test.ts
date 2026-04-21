import {
  isRWXTestEnabled,
  getRWXStorageClass,
  RWX_SKIP_MESSAGE
} from './test-setup'

describe('RWX Test Contract Demo', () => {
  const describeOrSkip = isRWXTestEnabled() ? describe : describe.skip

  describeOrSkip('RWX volume tests', () => {
    it('should use RWX storage class when enabled', () => {
      const storageClass = getRWXStorageClass()
      expect(storageClass).toBeDefined()
      expect(typeof storageClass).toBe('string')
    })

    it('should verify both env vars are required', () => {
      expect(process.env.ACTIONS_RUNNER_K8S_TEST_ENABLE_RWX).toBe('true')
      expect(
        process.env.ACTIONS_RUNNER_K8S_TEST_RWX_STORAGE_CLASS
      ).toBeDefined()
    })
  })

  if (!isRWXTestEnabled()) {
    it(RWX_SKIP_MESSAGE, () => {})
  }
})
