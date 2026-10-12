# UI inspiration: "Customer Journey CRM Dashboard" (Dribbble)

Reference: https://dribbble.com/shots/24659454-Customer-Journey-CRM-Dashboard by Jack R. for
RonDesignLab. The shot is third-party work and is **not** copied into this repository. This
note records what the product owner pointed at and how we adapt it.

## What the reference shows

- A light, calm workspace: soft off-white background, white cards with large radii
  (roughly 20 to 24 px), very light borders, generous whitespace, no heavy shadows.
- A slim top bar with a wordmark on the left, centred pill navigation (the active item is a
  solid black pill), and search / inbox / notifications / avatar on the right.
- A thin vertical rail on the left with round icon buttons (share, upload, favourite, add,
  devices, data, calendar, send, alerts) and a theme toggle at the bottom.
- A large page title ("Customer Journeys") and a board of four stage columns ("Case
  Allocation", "Issue Identification", "Technical Resolution", "New Tasks") where each column
  is a card containing task rows with an avatar, two-line label, a completion tick and a
  calendar button. Connectors link stages. A strong black call-to-action tile ("Request
  Processing") sits among muted tiles.
- A row of assignee avatars with small coloured count badges.
- Two lower cards: a table ("Suggested Knowledge": subject, status chip, start/end date,
  assigned user) and donut KPIs ("Support Ticket Journey": executed vs active).
- Status chips are pastel-filled with dark text (blue "Executed", red "Scheduled").

## What we adopt

- Hierarchy: one page title, cards as the unit of layout, whitespace instead of dividers.
- Card radius 16 to 20 px, hairline borders, elevation only on overlays and sticky actions.
- Pill-style primary navigation on desktop top bar, with a persistent left rail for module
  navigation (the brief requires a persistent left nav with collapsible groups).
- Stage-board pattern for the Production board (work orders by state) and the Order board.
- Avatar-with-count pattern for assignee load and approval queues.
- Donut and sparkline KPIs with clear legends, paired with a table that drills down.
- Status chips: filled pastel + dark text + leading icon or text, never colour alone.

## What we deliberately change

- Colour: botanical green primary (Bryel's Care brand) instead of black; black is reserved
  for the single most important action on a page.
- Density: operators get fewer, larger targets (minimum 44 px) and card lists instead of
  wide tables on phones; supervisors and owners get denser tables on desktop.
- Risk states must be unmistakable: Quarantined, QA Hold, Expired, Recalled, Rejected,
  Sync Pending, Approval Required use icon + label + colour + border treatment.
- Nothing decorative that costs touch space on a 360 px wide phone.
