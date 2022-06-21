import { getJobPodName, getRunnerPodName } from '../src/hooks/constants'

describe('constants', () => {
  describe('getRunnerPodName', () => {
    it('should throw if ACTIONS_RUNNER_POD_NAME env is not set', () => {
      delete process.env.ACTIONS_RUNNER_POD_NAME
      expect(() => getRunnerPodName()).toThrow()

      process.env.ACTIONS_RUNNER_POD_NAME = ''
      expect(() => getRunnerPodName()).toThrow()
    })

    it('should return corrent ACTIONS_RUNNER_POD_NAME name', () => {
      const name = 'example'
      process.env.ACTIONS_RUNNER_POD_NAME = name
      expect(getRunnerPodName()).toBe(name)
    })
  })

  describe('getJobPodName', () => {
    it('should throw on getJobPodName if ACTIONS_RUNNER_POD_NAME env is not set', () => {
      delete process.env.ACTIONS_RUNNER_POD_NAME
      expect(() => getJobPodName()).toThrow()

      process.env.ACTIONS_RUNNER_POD_NAME = ''
      expect(() => getRunnerPodName()).toThrow()
    })

    it('should contain suffix -workflow', () => {
      const tableTests = [
        {
          podName: 'test',
          expect: 'test-workflow'
        },
        {
          // 'a' * 63
          podName:
            'abcdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          expect:
            'abcdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-workflow'
        }
      ]
    })
  })
})
