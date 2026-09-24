import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRate } from "../src/rate";
import { HttpError } from "../src/errors";
import { hitRateLimit } from "../src/db";

vi.mock("../src/db", async () => ({
  hitRateLimit: vi.fn(),
}));

const hitMock = vi.mocked(hitRateLimit);

function env(db: D1Database) {
  return { DB: db } as never;
}

beforeEach(() => {
  vi.useRealTimers();
  hitMock.mockReset();
  hitMock.mockResolvedValue(true);
});

describe("checkRate", () => {
  it("allows requests while under the limit", async () => {
    await expect(checkRate(env({} as D1Database), "unlock", "ip:1", 10, 600)).resolves.toBeUndefined();
    expect(hitMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with 429 once the limit is reached", async () => {
    hitMock.mockResolvedValue(false);
    await expect(checkRate(env({} as D1Database), "unlock", "ip:1", 10, 600)).rejects.toBeInstanceOf(HttpError);
    await expect(checkRate(env({} as D1Database), "unlock", "ip:1", 10, 600)).rejects.toMatchObject({ status: 429 });
  });

  it("aligns the window start to the fixed window, not the raw timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(12_345_678_000));
    await checkRate(env({} as D1Database), "unlock", "ip:1", 10, 600);
    expect(hitMock).toHaveBeenCalledWith(expect.anything(), "unlock", "ip:1", 12_345_600, 10);
  });

  it("counts scopes and keys independently", async () => {
    const e = env({} as D1Database);
    await checkRate(e, "a", "x", 1, 60);
    await checkRate(e, "a", "y", 1, 60);
    await checkRate(e, "b", "x", 1, 60);
    expect(hitMock).toHaveBeenNthCalledWith(1, expect.anything(), "a", "x", expect.any(Number), 1);
    expect(hitMock).toHaveBeenNthCalledWith(2, expect.anything(), "a", "y", expect.any(Number), 1);
    expect(hitMock).toHaveBeenNthCalledWith(3, expect.anything(), "b", "x", expect.any(Number), 1);
  });

  it("fails open when the database errors (default)", async () => {
    hitMock.mockRejectedValueOnce(new Error("db down"));
    await expect(checkRate(env({} as D1Database), "fetch", "ip:1", 300, 60)).resolves.toBeUndefined();
  });

  it("fails closed for password endpoints when the database errors", async () => {
    hitMock.mockRejectedValueOnce(new Error("db down"));
    await expect(checkRate(env({} as D1Database), "unlock", "ip:1", 10, 600, false)).rejects.toThrow("db down");
  });
});
