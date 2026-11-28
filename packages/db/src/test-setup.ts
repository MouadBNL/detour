import { beforeAll } from "vite-plus/test";
import { bootTestDb } from "./testing.ts";

beforeAll(bootTestDb, 30_000);
