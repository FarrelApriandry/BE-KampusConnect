function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  ALLOWED_CAMPUS_DOMAINS: (process.env.ALLOWED_CAMPUS_DOMAINS ?? "untidar.ac.id,students.untidar.ac.id")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "admin@untidar.ac.id",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "Admin123!",
};
