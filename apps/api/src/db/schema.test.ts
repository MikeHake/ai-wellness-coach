import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activities,
  activityDetails,
  checkins,
  restLogs,
  users,
} from "./schema.js";
import { createTestDb } from "./test-db.js";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  // Cascades clear every log table too.
  await testDb.db.delete(users);
});

async function addUser(authSubject = "auth0|user-a") {
  const [user] = await testDb.db
    .insert(users)
    .values({ authSubject, timezone: "America/Denver" })
    .returning();
  if (!user) throw new Error("user was not created");
  return user;
}

// Drizzle wraps driver errors, so look for the constraint name in the cause.
async function expectViolation(promise: Promise<unknown>, constraint: string) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error).cause;
  const message =
    cause instanceof Error ? cause.message : (error as Error).message;
  expect(message).toContain(constraint);
}

describe("defaults", () => {
  it("fills in ids, timestamps, units, and empty feel words", async () => {
    const user = await addUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.units).toBe("imperial");
    expect(user.createdAt).toBeInstanceOf(Date);

    const [activity] = await testDb.db
      .insert(activities)
      .values({
        userId: user.id,
        startedAt: new Date(),
        activityType: "mountain_bike",
      })
      .returning();
    expect(activity?.feelWords).toEqual([]);
    expect(activity?.rawText).toBeNull();
    expect(activity?.updatedAt).toBeInstanceOf(Date);
  });

  it("round-trips timestamptz as the same instant", async () => {
    const user = await addUser();
    const instant = new Date("2026-03-08T01:30:00-07:00");
    const [activity] = await testDb.db
      .insert(activities)
      .values({ userId: user.id, startedAt: instant, activityType: "run" })
      .returning();
    expect(activity?.startedAt.getTime()).toBe(instant.getTime());
  });
});

describe("check constraints", () => {
  it("rejects feeling scores outside 1 to 5", async () => {
    const user = await addUser();
    const base = {
      userId: user.id,
      startedAt: new Date(),
      activityType: "run",
    };

    await expectViolation(
      testDb.db.insert(activities).values({ ...base, felt: 0 }),
      "activities_felt_check",
    );
    await expectViolation(
      testDb.db.insert(activities).values({ ...base, felt: 6 }),
      "activities_felt_check",
    );
    await expectViolation(
      testDb.db
        .insert(checkins)
        .values({ userId: user.id, at: new Date(), energy: 9 }),
      "checkins_energy_check",
    );
    await expectViolation(
      testDb.db
        .insert(restLogs)
        .values({ userId: user.id, date: "2026-10-01", soreness: 0 }),
      "rest_logs_soreness_check",
    );
  });

  it("accepts scores at the edges and nulls", async () => {
    const user = await addUser();
    await testDb.db.insert(checkins).values({
      userId: user.id,
      at: new Date(),
      energy: 1,
      mood: 5,
      stress: null,
    });
  });

  it("rejects unknown effort, setting, companions, and units", async () => {
    const user = await addUser();
    const base = {
      userId: user.id,
      startedAt: new Date(),
      activityType: "run",
    };

    await expectViolation(
      testDb.db.insert(activities).values({ ...base, effort: "extreme" }),
      "activities_effort_check",
    );
    await expectViolation(
      testDb.db.insert(activities).values({ ...base, setting: "underwater" }),
      "activities_setting_check",
    );
    await expectViolation(
      testDb.db.insert(activities).values({ ...base, companions: "crowd" }),
      "activities_companions_check",
    );
    await expectViolation(
      testDb.db
        .insert(users)
        .values({ authSubject: "auth0|x", timezone: "UTC", units: "cubits" }),
      "users_units_check",
    );
  });

  it("rejects non-positive durations and impossible sleep lengths", async () => {
    const user = await addUser();

    await expectViolation(
      testDb.db.insert(activities).values({
        userId: user.id,
        startedAt: new Date(),
        activityType: "run",
        durationMin: 0,
      }),
      "activities_duration_check",
    );
    await expectViolation(
      testDb.db
        .insert(restLogs)
        .values({ userId: user.id, date: "2026-10-01", sleepMinutes: 1441 }),
      "rest_logs_sleep_minutes_check",
    );
  });
});

describe("uniqueness", () => {
  it("rejects a duplicate auth subject", async () => {
    await addUser("auth0|same");
    await expectViolation(addUser("auth0|same"), "users_auth_subject_unique");
  });

  it("allows one rest log per user per day", async () => {
    const user = await addUser();
    const other = await addUser("auth0|user-b");

    await testDb.db
      .insert(restLogs)
      .values({ userId: user.id, date: "2026-10-01" });
    await testDb.db
      .insert(restLogs)
      .values({ userId: user.id, date: "2026-10-02" });
    await testDb.db
      .insert(restLogs)
      .values({ userId: other.id, date: "2026-10-01" });

    await expectViolation(
      testDb.db
        .insert(restLogs)
        .values({ userId: user.id, date: "2026-10-01" }),
      "rest_logs_user_date_unique",
    );
  });
});

describe("cascade deletes", () => {
  it("removes a user's data but leaves other users alone", async () => {
    const gone = await addUser("auth0|gone");
    const kept = await addUser("auth0|kept");

    for (const user of [gone, kept]) {
      const [activity] = await testDb.db
        .insert(activities)
        .values({
          userId: user.id,
          startedAt: new Date(),
          activityType: "hike",
        })
        .returning();
      if (!activity) throw new Error("activity was not created");
      await testDb.db
        .insert(activityDetails)
        .values({ activityId: activity.id, details: { distance_km: 12 } });
      await testDb.db
        .insert(checkins)
        .values({ userId: user.id, at: new Date(), mood: 4 });
      await testDb.db
        .insert(restLogs)
        .values({ userId: user.id, date: "2026-10-01" });
    }

    await testDb.db.delete(users).where(eq(users.id, gone.id));

    expect(await testDb.db.select().from(users)).toHaveLength(1);
    expect(await testDb.db.select().from(activities)).toHaveLength(1);
    expect(await testDb.db.select().from(activityDetails)).toHaveLength(1);
    expect(await testDb.db.select().from(checkins)).toHaveLength(1);
    expect(await testDb.db.select().from(restLogs)).toHaveLength(1);
    expect((await testDb.db.select().from(activities))[0]?.userId).toBe(
      kept.id,
    );
  });
});
