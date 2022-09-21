import { buildContainer } from '../src/k8s'
import { TestHelper } from './test-setup'

jest.useRealTimers()

describe('container build', () => {
  beforeAll(async () => {
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'default'
  })

  it('should finish without throwing an exception', async () => {
    await expect(buildContainer()).resolves.not.toThrow()
  })
})
