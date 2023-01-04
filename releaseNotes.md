## Features
- Always use the Docker related ENVs from the host machine instead of ENVs from the runner job [#40]
- Use user defined entrypoints for service containers (instead of `tail -f /dev/null`)

## Bugs
- Fixed substring issue with /github/workspace and /github/file_commands [#35]
- Fixed issue related to setting hostPort and containerPort when formatting is not recognized by k8s default [#38]

<!-- ## Misc 
