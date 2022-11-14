import { optionsWithDockerEnvs, sanitize } from '../src/utils'

describe('Utilities', () => {
  it('should return sanitized image name', () => {
    expect(sanitize('ubuntu:latest')).toBe('ubuntulatest')
  })

  it('should return the same string', () => {
    const validStr = 'teststr8_one'
    expect(sanitize(validStr)).toBe(validStr)
  })

  describe('with docker options', () => {
    it('should augment options with docker environment variables', () => {
      process.env.DOCKER_HOST = 'unix:///run/user/1001/docker.sock'
      process.env.DOCKER_NOTEXIST = 'notexist'

      const optionDefinitions = [undefined, {}, { env: {} }]
      for (const opt of optionDefinitions) {
        let options = optionsWithDockerEnvs(opt)
        expect(options).toBeDefined()
        expect(options?.env).toBeDefined()
        expect(options?.env?.DOCKER_HOST).toBe(process.env.DOCKER_HOST)
        expect(options?.env?.DOCKER_NOTEXIST).toBe(process.env.DOCKER_NOTEXIST)
      }
    })

    it('should not overwrite provided docker option', () => {
      process.env.DOCKER_HOST = 'unix:///run/user/1001/docker.sock'
      process.env.DOCKER_NOTEXIST = 'notexist'
      const expectedDockerHost = 'unix://var/run/docker.sock'
      const opt = {
        env: {
          DOCKER_HOST: expectedDockerHost
        }
      }

      const options = optionsWithDockerEnvs(opt)
      expect(options).toBeDefined()
      expect(options?.env).toBeDefined()
      expect(options?.env?.DOCKER_HOST).toBe(expectedDockerHost)
      expect(options?.env?.DOCKER_NOTEXIST).toBe(process.env.DOCKER_NOTEXIST)
    })

    it('should not overwrite other options', () => {
      process.env.DOCKER_HOST = 'unix:///run/user/1001/docker.sock'
      process.env.DOCKER_NOTEXIST = 'notexist'
      const opt = {
        workingDir: 'test',
        input: Buffer.from('test')
      }

      const options = optionsWithDockerEnvs(opt)
      expect(options).toBeDefined()
      expect(options?.workingDir).toBe(opt.workingDir)
      expect(options?.input).toBe(opt.input)
    })
  })
})
