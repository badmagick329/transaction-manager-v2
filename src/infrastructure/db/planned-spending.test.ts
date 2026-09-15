import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "./client";
import { DrizzlePlannedSpendingRepository } from "./drizzle-planned-spending-repository";
import { createPlannedSpendingRoutes } from "../http/planned-spending-routes";
import { plannedMonthly, plannedTotal } from "../../app/planned-spending";

const celsius = { name: "Celsius packs", currencyCode: "GBP", priceMinor: 1970, quantity: 2, interval: 1, unit: "months" as const, included: true };
test("manual plans persist independently, normalize custom intervals and exclude disabled/other currencies", async () => {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "planned-test-")), "app.db")); migrate(db, { migrationsFolder: "drizzle" });
  const repository = new DrizzlePlannedSpendingRepository(db);
  const saved = repository.save(celsius);
  repository.save({ ...celsius, name: "Protein", priceMinor: 6000, quantity: 1, interval: 5 });
  repository.save({ ...celsius, currencyCode: "EUR" });
  expect(plannedTotal(new DrizzlePlannedSpendingRepository(db).list(), "GBP")).toBe(5140);
  repository.save({ ...celsius, included: false }, saved.id);
  expect(plannedTotal(repository.list(), "GBP")).toBe(1200);
  expect(plannedMonthly({ ...celsius, priceMinor: 1200, quantity: 1, interval: 2, unit: "weeks" })).toBe(2600);
  repository.remove(saved.id);
  expect(repository.list()).toHaveLength(2);
  expect(() => repository.save(celsius, saved.id)).toThrow("not found");
  db.$client.close();
});

test("plan API rejects invalid numbers and saves and deletes valid entries", async () => {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "planned-test-")), "app.db")); migrate(db, { migrationsFolder: "drizzle" });
  const repository = new DrizzlePlannedSpendingRepository(db);
  const routes = createPlannedSpendingRoutes(repository);
  const post = (input: unknown) => routes["/api/planned-spending"].POST(new Request("http://local/api/planned-spending", { method: "POST", body: JSON.stringify(input) }));
  for (const invalid of [{ interval: 0 }, { quantity: 0.5 }, { priceMinor: -1 }, { unit: "days" }, { currencyCode: "bad" }, { name: " " }, { included: "yes" }]) {
    expect((await post({ ...celsius, ...invalid })).status).toBe(400);
  }
  const response = await post(celsius); expect(response.status).toBe(200);
  const saved = await response.json();
  expect((await routes["/api/planned-spending"].GET(new Request("http://local"))).status).toBe(200);
  await routes["/api/planned-spending/remove"].POST(new Request("http://local", { method: "POST", body: JSON.stringify({ id: saved.id }) }));
  expect(repository.list()).toEqual([]);
  db.$client.close();
});
