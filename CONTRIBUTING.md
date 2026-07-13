# Contributing to openORG

Thank you for helping make organizational learning portable and customer-owned.

## Before opening a pull request

1. Keep the change focused and explain the behavior it changes.
2. Add or update tests for protocol and enforcement behavior.
3. Run the relevant checks:

   ```sh
   pnpm schemas
   pnpm test
   pnpm build
   pnpm lint
   pnpm conformance
   ```

4. Sign off every commit under the Developer Certificate of Origin 1.1.

## Developer Certificate of Origin

openORG uses the [Developer Certificate of Origin 1.1](DCO), not a contributor
license agreement. The DCO is a short certification that you wrote the change,
or otherwise have the right to contribute it under the repository's license.
You retain your copyright; your contribution is licensed under Apache-2.0 with
the rest of the project.

Add the certification to a commit with:

```sh
git commit -s -m "Describe the change"
```

Git adds a line like this using your configured name and email:

```text
Signed-off-by: Your Name <you@example.com>
```

The sign-off must use an identity you are authorized to use. If a commit is
missing it, amend the commit before the pull request is merged:

```sh
git commit --amend --signoff --no-edit
```

By adding the sign-off, you certify the terms in [DCO](DCO).

## Protocol changes

Changes to ORP or OLP should include:

- the versioned schema or contract change;
- a migration or compatibility note when existing records are affected;
- conformance coverage; and
- an honest statement of what is enforced now versus left to an adapter or
  deployment.

Do not weaken provenance, consent, verification, correction history, or causal
lineage to make an integration easier. An adapter is compatible only when it
preserves those semantics.

## Trademark note

Contributing code does not grant rights to use the openORG names or logos as a
separate product brand. See [TRADEMARKS.md](TRADEMARKS.md).
