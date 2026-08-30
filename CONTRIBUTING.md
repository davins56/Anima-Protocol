# Contributing to Anima Protocol

Thank you for helping build Anima Protocol.

Anima Protocol is an open-source platform for persistent AI companions with memory, identity, personality, multimodal capabilities, and multi-character experiences. Contributions that improve reliability, usability, documentation, safety, memory quality, and developer experience are welcome.

## Getting Started

1. Fork the repository or create a branch if you are an existing collaborator.
2. Clone the repository locally.
3. Use Node 24 and pnpm.
4. Install dependencies with `pnpm install --frozen-lockfile`.
5. Read `AGENTS.md` before changing runtime setup, authentication, analytics, or AI infrastructure.
6. Create a focused feature or fix branch.
7. Make your changes and add or update tests where appropriate.
8. Run the relevant validation commands before opening a pull request.

## Development

The repository is a pnpm monorepo. The primary application lives in `artifacts/anima-protocol`, the Express API lives in `artifacts/api-server`, and shared database code lives in `lib/db`.

For the full local setup, environment variables, database initialization, and Anima LLM instructions, see the root `README.md` and `AGENTS.md`.

## Pull Requests

Keep pull requests focused and easy to review. Include:

- What changed
- Why it changed
- How it was tested
- Screenshots or recordings for visible UI changes
- Any migration, configuration, or environment-variable changes

Avoid combining unrelated refactors and product changes in one pull request.

## Validation

Before opening a pull request, run the checks relevant to your change. The standard validation commands are documented in the root `README.md`.

## Good First Contributions

New contributors should look for issues labeled:

- `good first issue`
- `help wanted`
- `documentation`
- `enhancement`

If you are unsure where to begin, open an issue describing what you would like to improve before investing in a large change.

## Product Principles

Contributions should reinforce the project's core direction:

- Companions should preserve a coherent identity across interactions.
- Memory should be useful, controllable, and scoped appropriately.
- Multi-character experiences should preserve distinct voices and context.
- User consent and privacy should remain explicit, especially around analytics and stored data.
- Local and self-hosted AI paths should remain first-class where practical.

## Community

Be constructive, specific, and respectful when reviewing code or discussing product direction. Good technical disagreement sharpens the project; personal attacks do not.

Thank you for contributing to Anima Protocol.
