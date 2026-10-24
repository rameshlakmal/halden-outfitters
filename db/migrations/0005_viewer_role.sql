-- Phase 5: a read-only staff role for the public demo login.

-- A viewer opens the staff admin's sections that hold no customer details, and changes nothing.
ALTER TYPE staff_role ADD VALUE 'viewer';
