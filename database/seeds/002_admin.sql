-- KampusConnect seed: default admin account (idempotent).
-- Password default: Admin123! — ganti setelah login pertama.
-- Hash bcrypt di bawah = "Admin123!". Regenerate: Bun.password.hash("...", {algorithm:"bcrypt",cost:10}).
INSERT INTO users (name, email, password_hash, role, verification_status, account_status)
VALUES (
  'Admin Kampus',
  'admin@untidar.ac.id',
  '$2b$10$nxXcac91feNRn3o02dblqugysosRLm7Bzq2TERr4.n6CzMd/.h8X6',
  'ADMIN',
  'VERIFIED',
  'ACTIVE'
)
ON CONFLICT (email) DO UPDATE SET role = 'ADMIN', verification_status = 'VERIFIED';
