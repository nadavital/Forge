-- Align opportunity statuses with the frontend/backend contract.

alter table public.opportunities
  drop constraint if exists opportunities_status_check;

alter table public.opportunities
  add constraint opportunities_status_check
  check (status in (
    'proposed',
    'recommended',
    'watched',
    'watching',
    'researching',
    'rejected',
    'approved',
    'prototyping',
    'building',
    'built',
    'archived'
  ));
