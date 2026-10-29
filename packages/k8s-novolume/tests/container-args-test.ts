import { createContainerSpec } from '../src/hooks/prepare-job'

describe('job and service container arguments', () => {
  it.each(['sh', '/bin/sh', 'bash', '/bin/bash', undefined])(
    'preserves argument boundaries with entrypoint %p',
    entryPoint => {
      const args = ['-c', 'printf "%s" "$1"', 'label', 'hello world', '']
      const container = createContainerSpec(
        {
          image: 'ubuntu',
          contextName: 'service',
          entryPoint,
          entryPointArgs: args
        },
        'service'
      )

      expect(container.command).toEqual(entryPoint ? [entryPoint] : undefined)
      expect(container.args).toEqual(args)
    }
  )

  it('decodes runner-quoted arguments without losing spaces, quotes or empty strings', () => {
    const args = ['hello world', '"literal quotes"', '']
    const container = createContainerSpec(
      {
        image: 'ubuntu',
        contextName: 'service',
        entryPoint: 'echo',
        entryPointArgs: String.raw`"hello world" "\"literal quotes\"" ""`.split(
          ' '
        )
      },
      'service'
    )

    expect(container.args).toEqual(args)
  })
})
