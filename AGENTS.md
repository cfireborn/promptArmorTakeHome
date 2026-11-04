# Agent Instructions — ClearPath / Relay

## Minimum effective change

Choose the smallest change that correctly solves the problem. Read relevant files and trace the call chain before changing them. Match established patterns. Fix the cause, not a symptom; do not refactor unrelated code or invent abstractions without a concrete need. Derive state where possible instead of storing duplicate values.

The user has authorized building this new product end to end, including substantial implementation, review, commits, and deployment. Routine implementation does not need another scope confirmation. Keep fixes narrow once a feature works. Do not leave TODOs or claim verification that did not happen.

## Product truth

- We chose the compliance reviewer as the primary workspace and waiting/back-and-forth as the initial bottleneck hypothesis. The CTO left both choices open and confirmed the objective is throughput.
- Help reviewers return concrete, pre-approved changes that creative can accept quickly.
- Approval binds an exact asset version and product, audience, channel, and placement. A changed asset or scope needs another compliance decision.
- Exactly one or two excellent AI examples may be deterministic fixtures; label simulations honestly. The former blanket assumption about human final decisions was withdrawn by the user; retain the requested pre-approved-fix workflow without treating that assumption as a constraint.
- Include comments, ownership, status, history, Slack handoff, and CSV export. Do not imply real Slack delivery without a connected service.
- The guided demo progresses from clean approval to small fix to larger revision. One primary action per stage; unknown spec coverage blocks auto-clear, and Slack delivery/receipt remain distinct from approval.
- A good human experience takes priority over feature count. Use semantic controls, keyboard focus, reduced motion, empty states, and responsive layouts.

## Delivery

- Keep release changes in descriptive commits. Preserve the existing development GIFs and their accurate captions.
- Keep README concise, personal, and accurate, following the structure of `cfireborn/astrocadeKanbanTakeHome`.
- Document assumptions, technology choices, deployment, limitations, test evidence, and a few product reflections.
- Use GitHub Pages-compatible static output. Do not touch unrelated hosted files or the other prototype's working directory.
- Never commit secrets, node_modules, or raw large recordings. Keep GIFs small and within GitHub limits.
- Use adversarial agents for product, implementation, README, and deployment reviews as useful; give each clear file ownership. Address material findings before claiming completion.
- Test meaningful workflow invariants and a real browser path. Distinguish local verification from deployment verification.
