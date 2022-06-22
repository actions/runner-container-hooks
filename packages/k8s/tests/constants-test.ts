import {
  getJobPodName,
  getRunnerPodName,
  getVolumeClaimName,
  RunnerInstanceLabel
} from '../src/hooks/constants'

describe('constants', () => {
  describe('runner instance label', () => {
    beforeEach(() => {
      process.env.ACTIONS_RUNNER_POD_NAME = 'example'
    })
    it('should throw if ACTIONS_RUNNER_POD_NAME env is not set', () => {
      delete process.env.ACTIONS_RUNNER_POD_NAME
      expect(() => new RunnerInstanceLabel()).toThrow()
    })

    it('should have key truthy', () => {
      const runnerInstanceLabel = new RunnerInstanceLabel()
      expect(typeof runnerInstanceLabel.key).toBe('string')
      expect(runnerInstanceLabel.key).toBeTruthy()
      expect(runnerInstanceLabel.key.length).toBeGreaterThan(0)
    })

    it('should have value as runner pod name', () => {
      const name = process.env.ACTIONS_RUNNER_POD_NAME as string
      const runnerInstanceLabel = new RunnerInstanceLabel()
      expect(typeof runnerInstanceLabel.value).toBe('string')
      expect(runnerInstanceLabel.value).toBe(name)
    })

    it('should have toString combination of key and value', () => {
      const runnerInstanceLabel = new RunnerInstanceLabel()
      expect(runnerInstanceLabel.toString()).toBe(
        `${runnerInstanceLabel.key}=${runnerInstanceLabel.value}`
      )
    })
  })

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
          // podName.length == 63
          podName:
            'abcdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          expect:
            'abcdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-workflow'
        }
      ]

      for (const tt of tableTests) {
        process.env.ACTIONS_RUNNER_POD_NAME = tt.podName
        const got = getJobPodName()
        expect(got).toBe(tt.expect)
      }
    })
  })

  describe('getVolumeClaimName', () => {
    it('should throw on getJobPodName if ACTIONS_RUNNER_POD_NAME env is not set', () => {
      delete process.env.ACTIONS_RUNNER_CLAIM_NAME
      delete process.env.ACTIONS_RUNNER_POD_NAME
      expect(() => getVolumeClaimName()).toThrow()

      process.env.ACTIONS_RUNNER_POD_NAME = ''
      expect(() => getVolumeClaimName()).toThrow()
    })

    it('should return ACTIONS_RUNNER_CLAIM_NAME env if set', () => {
      const claimName = 'testclaim'
      process.env.ACTIONS_RUNNER_CLAIM_NAME = claimName
      process.env.ACTIONS_RUNNER_POD_NAME = 'example'
      expect(getVolumeClaimName()).toBe(claimName)
    })

    it('should contain suffix -work if ACTIONS_RUNNER_CLAIM_NAME is not set', () => {
      delete process.env.ACTIONS_RUNNER_CLAIM_NAME
      process.env.ACTIONS_RUNNER_POD_NAME = 'example'
      expect(getVolumeClaimName()).toBe('example-work')
    })
  })
})
