import { describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

describe("GET /health", () => {
  it("responde com o contrato de health e reflete o estado do banco", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();

    expect([200, 503]).toContain(response.statusCode);
    expect(body).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      database: expect.stringMatching(/^(up|down)$/),
    });
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);

    await app.close();
  });
});
