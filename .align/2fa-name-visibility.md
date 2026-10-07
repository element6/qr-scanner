# align: 2fa name visibility

## Brief

**Objective** — 2FA issuer/account names render at full length, wrapped, in the
vault card and the 2FA history row. Option A (no clamp) confirmed against a
rendered side-by-side preview.

**Who** — Single user, this device, local-only vault data.

**Why now** — History names + 60s idle lock already landed in `092fc54 ✅`.
Name clipping was the remaining 2FA rough edge.

**Done-when**
1. `TwoFactorPanel.tsx:822,824` — drop `line-clamp-2` from issuer and account
   `<p>`. Add `break-words` (unbroken IAM ARNs overflow without it). Keep
   `min-w-0 flex-1`.
2. `ScanHistory.tsx:247,249` — drop `line-clamp-1` from issuer and account.
3. Outer content wrapper keeps `line-clamp-2` so `measure()` and the Expand
   button stay correct.
4. No issuer or account string shows an ellipsis at any viewport width.

**Wrong-if** — an ellipsis still appears on a name line at any width.

**Constraints**
- `measure()` (`ScanHistory.tsx:135-158`) untouched — it toggles the *wrapper*
  clamp to compute `isClipped`; inner name clamps are independent.
- Non-otpauth history rows untouched.
- No vault schema, crypto, or export/import change.

**Out of scope** — custom name field, custom icon, provider import templates,
clamp-line tuning, row-height equalisation.

## Ledger

| # | Question | Confidence | Note |
|---|---|---|---|
| 1 | Custom name/icon source? | 0.99 | Resolved: user dropped icon AND custom name. Scope = visibility only. |
| 2 | Clamp vs full wrap? | 0.99 | Resolved: full wrap, Option A, confirmed visually. |
| 3 | Brief accepted? | 0.9 | Brief restated below; awaiting explicit yes. |

## Decision Log

**D1 — custom name + icon dropped** → options (override field / re-parse only /
import template) → user chose none: "ignore the icon request, just make name
visible, not trimmed" → naming is cosmetic at the display layer, not data →
P(A) 0.9.

**D2 — clamp vs full wrap** → options (full wrap no clamp / clamp-3/4 /
full wrap + stretch) → visual preview shown, user picked Option A → uneven row
height accepted as cheaper than an arbitrary line budget → P(A) 0.85.

## Resolved Branches

- Source of name text → `otpauthIdentity` / `issuerLabel(entry)`; unchanged.
- Measure/Expand coupling → none, inner clamps independent of wrapper clamp.

## Open Branches

- None. Ready to implement.