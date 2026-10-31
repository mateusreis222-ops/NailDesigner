# Edge Functions — planned endpoints

Suggested functions for the next implementation phase:

- `create-booking`: authenticate customer, validate service and availability, calculate 50% deposit, create a 30-minute temporary reservation atomically.
- `expire-bookings`: scheduled job that expires unpaid reservations after their deadline.
- `confirm-payment`: internal, authenticated operation for manual confirmation by the owner.
- `pix-webhook`: validate provider signature, deduplicate event, record payment, and confirm appointment.
- `send-whatsapp`: send approved templates and persist delivery status.
- `request-cancellation`: validate 24-hour policy and create a cancellation review when required.

Do not trust price, deposit, business ID, customer ID, appointment status or payment status supplied by the browser. Recalculate and validate on the server.
