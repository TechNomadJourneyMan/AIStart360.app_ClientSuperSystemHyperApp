# Journey HONOR share link

## Goal

Publish a direct, isolated URL that opens AIStart360 Journey with a clearly
labelled HONOR internet-store demo project already populated.

## Changes

1. Add a typed demo-scenario factory that builds the project through the same
   deterministic Journey flow used by the product: business description →
   confirmed Point A facts → measurable Point B → roadmap/widgets.
2. Accept `?demo=honor` on `/journey` (and its client alias) and pass the
   allowlisted scenario into `JourneyWorkspace`.
3. Store scenario identity/state under a scenario-specific browser key so the
   demo neither overwrites nor reads the user's normal Journey workspace.
4. Seed only public facts from `myhonor.shop` (catalog, positioning, delivery,
   stores and loyalty) and keep unknown commerce KPIs unknown.
5. Mark the 20% / 6-month Point B as a test hypothesis, never as a real HONOR
   target or performance claim.
6. Add focused unit and Playwright coverage, then run typecheck/lint/tests/build
   and verify the deployed desktop/mobile URL.

## Expected URL

`https://aistart360-journey-demo.vercel.app/journey?demo=honor`
