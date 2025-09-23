## Runner Container Hooks
The Runner Container Hooks repo provides a set of packages that implement the container hooks feature in the [actions/runner](https://github.com/actions/runner). These can be used as is, or you can use them as a guide to implement your own hooks.

More information on how to implement your own hooks can be found in the [adr](https://github.com/actions/runner/pull/1891). The `examples` folder provides example inputs for each hook.

### Note

Thank you for your interest in this GitHub action, however, right now we are not taking contributions. 

We continue to focus our resources on strategic areas that help our customers be successful while making developers' lives easier. While GitHub Actions remains a key part of this vision, we are allocating resources towards other areas of Actions and are not taking contributions to this repository at this time. The GitHub public roadmap is the best place to follow along for any updates on features we’re working on and what stage they’re in.

We are taking the following steps to better direct requests related to GitHub Actions, including:

1. We will be directing questions and support requests to our [Community Discussions area](https://github.com/orgs/community/discussions/categories/actions)

2. High Priority bugs can be reported through Community Discussions or you can report these to our support team https://support.github.com/contact/bug-report.

3. Security Issues should be handled as per our [security.md](security.md)

We will still provide security updates for this project and fix major breaking changes during this time.

You are welcome to still raise bugs in this repo.

## Background 

Three projects are included in the `packages` folder
- k8s: A kubernetes hook implementation that spins up pods dynamically to run a job. More details can be found in the [readme](./packages/k8s/README.md)
- docker: A hook implementation of the runner's docker implementation. More details can be found in the [readme](./packages/docker/README.md)
- hooklib: a shared library which contains typescript definitions and utilities that the other projects consume

## License 

This project is licensed under the terms of the MIT open source license. Please refer to [MIT](./LICENSE.md) for the full terms.

## Maintainers 

See the [Codeowners](./CODEOWNERS)

## Support

Find a bug? Please file an issue in this repository using the issue templates.

## Code of Conduct

See our [Code of Conduct](./CODE_OF_CONDUCT.MD)
