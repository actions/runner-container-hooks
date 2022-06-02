export function getRunnerLabel(): string {
  const name = process.env.RUNNER_NAME
  if (!name) {
    throw new Error(
      "'RUNNER_NAME' env is required, please contact your self hosted runner administrator"
    )
  }
  return Buffer.from(name).toString('hex')
}
