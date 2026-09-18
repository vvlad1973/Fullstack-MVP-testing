import { describe, expect, it, vi } from "vitest";
import { createClient } from "../../scripts/deps/repo-client.mjs";

const pkg = { name: "pglite", scope: "@electric-sql", version: "0.4.1" };

function ok(artifacts: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ artifacts }), headers: new Headers() };
}

function fail(status: number, headers: Record<string, string> = {}) {
  return { ok: false, status, json: async () => ({}), headers: new Headers(headers), text: async () => "" };
}

function client(fetchImpl: unknown, overrides = {}) {
  return createClient({
    fetchImpl,
    getToken: vi.fn(async () => "T0"),
    sleep: vi.fn(async () => {}),
    random: () => 0,
    ...overrides,
  });
}

describe("createClient.findArtifacts", () => {
  it("шлёт имя и область раздельно и подставляет токен", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await client(fetchImpl).findArtifacts(pkg);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://repository.rt.ru/gateway/artifacts/findArtifacts");
    expect(init.headers.Authorization).toBe("Bearer T0");
    expect(JSON.parse(init.body)).toEqual({
      npm: { name: "pglite", scope: "@electric-sql", version: "0.4.1", state: {} },
      offset: 0,
      limit: 50,
      strict: false,
    });
  });

  it("забирает следующую страницу, когда ответ полон", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ npm: { version: `0.4.${i}` } }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(full))
      .mockResolvedValueOnce(ok([{ npm: { version: "0.4.99" } }]));
    const artifacts = await client(fetchImpl).findArtifacts(pkg);

    expect(artifacts).toHaveLength(51);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).offset).toBe(50);
  });

  it("выдерживает паузу перед каждым запросом", async () => {
    const sleep = vi.fn(async () => {});
    await client(vi.fn(async () => ok([])), { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("обновляет токен на 401 и повторяет запрос один раз", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(401)).mockResolvedValueOnce(ok([]));
    const getToken = vi.fn().mockResolvedValueOnce("T0").mockResolvedValueOnce("T1");
    await client(fetchImpl, { getToken }).findArtifacts(pkg);

    expect(getToken).toHaveBeenLastCalledWith({ force: true });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer T1");
  });

  it("сдаётся на втором 401 подряд", async () => {
    const fetchImpl = vi.fn(async () => fail(401));
    const error = await client(fetchImpl)
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/401/);
    // The CLI decides whether to stop the whole run off this flag, not by pattern-matching the
    // message — see the stopError() comment in repo-client.mjs.
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
  });

  it("на 429 ждёт столько, сколько просит сервер", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(429, { "Retry-After": "3" })).mockResolvedValueOnce(ok([]));
    await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("останавливается после трёх отказов подряд", async () => {
    const fetchImpl = vi.fn(async () => fail(503));
    const error = await client(fetchImpl)
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/503/);
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("останавливает прогон, когда сервер просит ждать дольше минуты", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => fail(429, { "Retry-After": "3600" }));
    const error = await client(fetchImpl, { sleep })
      .findArtifacts(pkg)
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/3600|час|минут/);
    expect((error as Error & { stopRun?: boolean }).stopRun).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalledWith(60000);
  });

  it("считает ответ без поля artifacts пустой страницей, а не падает", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: new Headers() }));
    await expect(client(fetchImpl).findArtifacts(pkg)).resolves.toEqual([]);
  });

  it("останавливается на потолке в 200 записей, даже если страницы всё ещё полны", async () => {
    const full = (from: number) => Array.from({ length: 50 }, (_, i) => ({ npm: { version: `0.4.${from + i}` } }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(full(0)))
      .mockResolvedValueOnce(ok(full(50)))
      .mockResolvedValueOnce(ok(full(100)))
      .mockResolvedValueOnce(ok(full(150)));
    const artifacts = await client(fetchImpl).findArtifacts(pkg);

    expect(artifacts).toHaveLength(200);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("удваивает выдержку по умолчанию, когда 503 пришёл без Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok([]));
    await client(fetchImpl, { sleep }).findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("даёт передышку в 5 секунд на пятидесятом запросе, даже между разными вызовами findArtifacts", async () => {
    const sleep = vi.fn(async () => {});
    const c = client(vi.fn(async () => ok([])), { sleep });
    for (let i = 0; i < 50; i += 1) await c.findArtifacts(pkg);
    sleep.mockClear();
    await c.findArtifacts(pkg);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("sent() считает все отправленные запросы, включая повтор после 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(401)).mockResolvedValueOnce(ok([]));
    const c = client(fetchImpl);
    await c.findArtifacts(pkg);
    expect(c.sent()).toBe(2);
  });
});
