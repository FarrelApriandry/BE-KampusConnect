-- KampusConnect base seeds: default categories (idempotent).
INSERT INTO categories (name, type) VALUES
  ('Elektronik', 'PRODUCT'),
  ('Buku & Modul', 'PRODUCT'),
  ('Kebutuhan Praktikum', 'PRODUCT'),
  ('Fashion', 'PRODUCT'),
  ('Kendaraan', 'PRODUCT'),
  ('Kos & Tempat Tinggal', 'SERVICE'),
  ('Jasa Desain', 'SERVICE'),
  ('Jasa Titip / Antar', 'SERVICE'),
  ('Les & Tutoring', 'SERVICE'),
  ('Lainnya', 'BOTH')
ON CONFLICT (name) DO NOTHING;
