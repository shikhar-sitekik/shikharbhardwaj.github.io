import { config } from "dotenv";

// Integration tests use a dedicated database. Never point this at production.
config({ path: ".env.test", override: true });
