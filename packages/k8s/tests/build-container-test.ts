import { containerBuild } from '../src/k8s'

jest.useRealTimers()

describe('container build', () => {
  beforeAll(async () => {
    process.env['ACTIONS_RUNNER_KUBERNETES_NAMESPACE'] = 'default'
  })

  it('should finish without throwing an exception', async () => {
    await expect(
      containerBuild(
        {
          workingDirectory: 'git://github.com/nikola-jokic/dockeraction.git'
        },
        'randhandle/randimg:123123'
      )
    ).resolves.not.toThrow()
  })
})
