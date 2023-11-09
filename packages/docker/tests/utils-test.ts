import { optionsWithDockerEnvs, sanitize, fixArgs } from '../src/utils'

describe('Utilities', () => {
  it('should return sanitized image name', () => {
    expect(sanitize('ubuntu:latest')).toBe('ubuntulatest')
  })

  it('should return the same string', () => {
    const validStr = 'teststr8_one'
    expect(sanitize(validStr)).toBe(validStr)
  })

  test.each([
    [['"Hello', 'World"'], ['Hello World']],
    [
      [
        'sh',
        '-c',
        `'[ $(cat /etc/*release* | grep -i -e "^ID=*alpine*" -c) != 0 ] || exit 1'`
      ],
      [
        'sh',
        '-c',
        `[ $(cat /etc/*release* | grep -i -e "^ID=*alpine*" -c) != 0 ] || exit 1`
      ]
    ],
    [
      [
        'sh',
        '-c',
        `'[ $(cat /etc/*release* | grep -i -e '\\''^ID=*alpine*'\\'' -c) != 0 ] || exit 1'`
      ],
      [
        'sh',
        '-c',
        `[ $(cat /etc/*release* | grep -i -e '^ID=*alpine*' -c) != 0 ] || exit 1`
      ]
    ]
  ])('should fix split arguments(%p, %p)', (args, expected) => {
    const got = fixArgs(args)
    expect(got).toStrictEqual(expected)
  })

  describe('with docker options', () => {
    it('should augment options with docker environment variables', () => {
      process.env.DOCKER_HOST = 'unix:///run/user/1001/docker.sock'
      process.env.DOCKER_NOTEXIST = 'notexist'

      const optionDefinitions: any = [
        undefined,
        {},
        { env: {} },
        { env: { DOCKER_HOST: 'unix://var/run/docker.sock' } }
      ]
      for (const opt of optionDefinitions) {
        let options = optionsWithDockerEnvs(opt)
        expect(options).toBeDefined()
        expect(options?.env).toBeDefined()
        expect(options?.env?.DOCKER_HOST).toBe(process.env.DOCKER_HOST)
        expect(options?.env?.DOCKER_NOTEXIST).toBeUndefined()
      }
    })

    it('should not overwrite other options', () => {
      process.env.DOCKER_HOST = 'unix:///run/user/1001/docker.sock'
      const opt = {
        workingDir: 'test',
        input: Buffer.from('test')
      }

      const options = optionsWithDockerEnvs(opt)
      expect(options).toBeDefined()
      expect(options?.workingDir).toBe(opt.workingDir)
      expect(options?.input).toBe(opt.input)
      expect(options?.env).toStrictEqual({
        DOCKER_HOST: process.env.DOCKER_HOST
      })
    })
  })
})
