# Working rules

- Follow Conventional Commits.
- Prefer established industry-standard practices and conventions, while keeping solutions lean and within scope.
- Use test-driven development where applicable.
- When editing Dockerfiles or Compose build configuration, prioritize reusing cached layers and incremental builds over minimizing layers. When explicitly asked to make them lean, consolidate layers and configuration while preserving behavior; verify relevant build and runtime behavior.
- Do not overengineer. Only implement features and tests directly related to the current ticket or planned scope; skip unrelated work.
- Review for repetition when a file exceeds 300 nonblank lines or the same logic/test setup appears 3+ times. These are review triggers, not mandatory refactoring targets.
- Factor repeated code and tests only within the current ticket’s touched code, when it clearly reduces duplication without speculative abstractions. Keep similar-looking code with different responsibilities separate; do not split files solely to meet a line limit.
- Keep all actions within this project folder or Docker.
- Proceed without asking permission for project-related or clearly safe actions within that scope. Ask before destructive or potentially dangerous actions unless explicitly authorized.
