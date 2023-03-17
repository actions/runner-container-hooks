## Features
- Use service container entrypoint if no entrypoint is specified [#53]

## Bugs
- Fixed issue caused by promise rejection in kubernetes hook [#65]
- Fixed service container name issue when service image contains one or more `/`
  in the name [#53]
- Fixed issue related to service container failures when no ports are specified
  [#60]
- Allow equal signs in environment variable values [#62]

<!-- ## Misc
