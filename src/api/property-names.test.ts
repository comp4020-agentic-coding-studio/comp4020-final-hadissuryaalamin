import fastify from "fastify";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createConnection } from "../db/connection.ts";
import { migrate } from "../db/schema.ts";
import { createSessionToken, SESSION_COOKIE_NAME } from "../auth/session.ts";
import adminRoutes, { propertyNameTaken } from "./admin.ts";
import { runTool } from "../assistant/tools.ts";
import { getProposal, clearProposal } from "../assistant/proposals.ts";

vi.mock("../realtime/broadcast.ts", () => ({ broadcast: vi.fn() }));
vi.spyOn(process.stdout, "write").mockImplementation(() => true);

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

function setup() {
  const db = createConnection(":memory:");
  const adminId = Number(
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('boss', 'h', 'admin')").run().lastInsertRowid,
  );
  const app = fastify();
  app.register(adminRoutes, { db });
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken({ user_id: adminId, role: "admin" }))}`;
  return { db, app, adminId, cookie };
}

describe("property names are unique", () => {
  it("the database refuses a second property with the same name, ignoring case and spaces", () => {
    const { db } = setup();
    db.prepare("INSERT INTO properties (name, address) VALUES ('King01', 'Kingston')").run();
    expect(() => db.prepare("INSERT INTO properties (name, address) VALUES (' king01 ', 'Elsewhere')").run()).toThrow();
  });

  it("propertyNameTaken matches ignoring case and spaces, and can exclude the row being edited", () => {
    const { db } = setup();
    const id = Number(db.prepare("INSERT INTO properties (name, address) VALUES ('King01', 'Kingston')").run().lastInsertRowid);
    expect(propertyNameTaken(db, "  KING01 ")).toBe(true);
    expect(propertyNameTaken(db, "King02")).toBe(false);
    expect(propertyNameTaken(db, "king01", id)).toBe(false);
  });

  it("POST /api/properties answers 409 with a readable message for a duplicate", async () => {
    const { db, app, cookie } = setup();
    await app.inject({ method: "POST", url: "/api/properties", headers: { cookie }, payload: { name: "King01", address: "Kingston" } });
    const res = await app.inject({ method: "POST", url: "/api/properties", headers: { cookie }, payload: { name: "king01", address: "Kingston" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('A property named "king01" already exists.');
    expect((db.prepare("SELECT COUNT(*) AS n FROM properties").get() as { n: number }).n).toBe(1);
  });

  it("PUT /api/properties/:id refuses renaming onto another property's name but allows keeping its own", async () => {
    const { app, cookie } = setup();
    const a = (await app.inject({ method: "POST", url: "/api/properties", headers: { cookie }, payload: { name: "King01", address: "Kingston" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/properties", headers: { cookie }, payload: { name: "King02", address: "Kingston" } })).json();
    const clash = await app.inject({ method: "PUT", url: `/api/properties/${b.id}`, headers: { cookie }, payload: { name: "KING01" } });
    expect(clash.statusCode).toBe(409);
    const same = await app.inject({ method: "PUT", url: `/api/properties/${a.id}`, headers: { cookie }, payload: { name: "King01", address: "New St" } });
    expect(same.statusCode).toBe(200);
  });

  it("the assistant leaves out names that already exist or repeat in the same request, and says so", async () => {
    const { db, adminId } = setup();
    db.prepare("INSERT INTO properties (name, address) VALUES ('King01', 'Kingston')").run();
    const ctx = { db, role: "admin" as const, userId: adminId };

    const reply = String(await runTool("propose_create_properties", ctx, {
      rows: [
        { name: "king01", address: "Kingston" },
        { name: "Bay02", address: "Bay Rd" },
        { name: "BAY02", address: "Bay Rd" },
      ],
    }));

    expect(reply).toContain("Left out, already exist: king01, BAY02.");
    const proposal = getProposal(adminId) as { data: { rows: { name: string }[] } };
    expect(proposal.data.rows.map((r) => r.name)).toEqual(["Bay02"]);
    clearProposal(adminId);
  });

  it("the CSV path leaves out existing names too", async () => {
    const { db, adminId } = setup();
    db.prepare("INSERT INTO properties (name, address) VALUES ('King01', 'Kingston')").run();
    const ctx = {
      db,
      role: "admin" as const,
      userId: adminId,
      attachedFile: { name: "p.csv", content: "name,address\nKing01,Kingston\nKing03,Kingston" },
    };

    const reply = String(await runTool("propose_create_properties_from_file", ctx));

    expect(reply.toLowerCase()).toContain("already exist");
    const proposal = getProposal(adminId) as { data: { rows: { name: string }[] } };
    expect(proposal.data.rows.map((r) => r.name)).toEqual(["King03"]);
    clearProposal(adminId);
  });

  it("migrating a database that already holds duplicates still boots, without the rule", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL)");
    db.exec("INSERT INTO properties (name, address) VALUES ('King01', 'Kingston'), ('King01', 'Kingston')");
    expect(() => migrate(db)).not.toThrow();
    expect((db.prepare("SELECT COUNT(*) AS n FROM properties").get() as { n: number }).n).toBe(2);
  });
});
