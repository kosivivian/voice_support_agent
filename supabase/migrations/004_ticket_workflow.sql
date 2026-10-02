-- Ticket workflow for the admin dashboard: open -> processing -> resolved.
-- ('closed' stays valid for older rows and is shown as resolved.)
-- Linked escalations follow along: processing -> in_progress, resolved -> closed.
alter type ticket_status add value if not exists 'processing';
alter type ticket_status add value if not exists 'resolved';
