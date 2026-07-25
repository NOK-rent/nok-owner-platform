-- NOK Owner Platform — Owner Notifications / Comunicados
-- Lets the NOK team push in-portal messages to owners (e.g. "pago atrasado").
-- Shown as a dismissable banner in the owner dashboard. Optional email is sent
-- separately via the existing Resend flow.

CREATE TABLE IF NOT EXISTS owner_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE CASCADE,  -- NULL = applies to the owner globally
  type        text NOT NULL DEFAULT 'info'
                CHECK (type IN ('info','success','warning','payment','urgent')),
  title       text NOT NULL,
  body        text NOT NULL,
  link_url    text,                       -- optional CTA link
  link_label  text,
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamptz,
  created_by  text,                       -- admin email that sent it
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_notifications_owner   ON owner_notifications(owner_id, is_read);
CREATE INDEX IF NOT EXISTS idx_owner_notifications_created ON owner_notifications(created_at DESC);
