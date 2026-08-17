import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createCalendarHandlers } from "../src/calendar.js";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const servicesRoot = resolve(serviceRoot, "..");

function readRequired(path, label) {
  assert.equal(existsSync(path), true, `${label} must be tracked in the OctoBus repository`);
  return readFileSync(path, "utf8");
}

test("tracked Calendar proto preserves existing RPCs and adds attendee mutations", () => {
  const proto = readRequired(resolve(serviceRoot, "proto/calendar.proto"), "Calendar proto");

  for (const rpc of [
    "ListEvents", "CreateEvent", "GetEvent", "UpdateEvent", "DeleteEvent",
    "AddEventAttendees", "RemoveEventAttendees",
  ]) {
    assert.match(proto, new RegExp(`rpc ${rpc}\\(`), `${rpc} RPC must be declared`);
  }
  assert.match(proto, /message CalendarEvent\s*\{[\s\S]*string id = 1;/);
  assert.match(proto, /string status = 9;/);
  assert.match(proto, /message UpdateEventRequest\s*\{[\s\S]*optional string title = 4;/);
  assert.match(proto, /optional string start = 5;/);
  assert.match(proto, /optional string end = 6;/);
  assert.match(proto, /optional string description = 7;/);
  assert.match(proto, /optional string timezone = 8;/);
  assert.match(proto, /message ListEventsRequest\s*\{[\s\S]*string profile = 3;/);
  assert.match(proto, /message AddEventAttendeesRequest\s*\{[\s\S]*repeated string attendees_to_add = 4;/);
  assert.match(proto, /message RemoveEventAttendeesRequest\s*\{[\s\S]*repeated string attendees_to_remove = 4;/);
});

test("tracked Calendar service exposes all handlers and requires per-request profile", () => {
  const source = readRequired(resolve(serviceRoot, "src/calendar.js"), "Calendar handlers");

  for (const method of [
    "ListEvents", "CreateEvent", "GetEvent", "UpdateEvent", "DeleteEvent",
    "AddEventAttendees", "RemoveEventAttendees",
  ]) {
    assert.match(
      source,
      new RegExp(`dingtalk\\.calendar\\.v1\\.CalendarService/${method}`),
      `${method} handler must be registered`,
    );
  }
  assert.match(source, /requireValue\(profile, ["']profile["']\)/);
});

test("root package and dispatcher expose dingtalk-calendar", () => {
  const pkg = JSON.parse(readRequired(resolve(servicesRoot, "package.json"), "services package.json"));
  const dispatcher = readRequired(resolve(servicesRoot, "bin/octobus-tentacles.js"), "root dispatcher");
  const wrapper = resolve(servicesRoot, "bin/dingtalk-calendar.js");

  assert.equal(pkg.bin?.["dingtalk-calendar"], "bin/dingtalk-calendar.js");
  assert.ok(pkg.files?.includes("bin/dingtalk-calendar.js"));
  assert.ok(pkg.files?.includes("dingtalk__calendar"));
  assert.match(dispatcher, /"dingtalk-calendar": \{/);
  assert.match(dispatcher, /entryFile: "\.\.\/dingtalk__calendar\/bin\/dingtalk-calendar\.js"/);
  assert.match(dispatcher, /serviceModule: "\.\.\/dingtalk__calendar\/src\/service\.js"/);
  assert.equal(existsSync(wrapper), true, "root dingtalk-calendar wrapper must be tracked");
});

function createHarness(responses = []) {
  const calls = [];
  const runDws = async (_ctx, args, options) => {
    calls.push({ args, options });
    return responses.shift() ?? { success: true, data: {} };
  };
  return { calls, handlers: createCalendarHandlers({ runDws }) };
}

test("ListEvents and CreateEvent preserve the installed Calendar behavior", async () => {
  const { calls, handlers } = createHarness([
    {
      success: true,
      data: {
        result: {
          events: [{
            id: "evt-list",
            summary: "客户沟通",
            start: { dateTime: "2026-08-09T09:00:00+08:00" },
            end: { dateTime: "2026-08-09T10:00:00+08:00" },
            description: "准备材料",
          }],
        },
      },
    },
    { success: true, data: { result: { id: "evt-created" } } },
  ]);

  const listed = await handlers["dingtalk.calendar.v1.CalendarService/ListEvents"]({
    request: { start: "2026-08-09T00:00:00+08:00", end: "2026-08-10T00:00:00+08:00" },
  });
  const created = await handlers["dingtalk.calendar.v1.CalendarService/CreateEvent"]({
    request: {
      title: "客户沟通",
      start: "2026-08-09T09:00:00+08:00",
      end: "2026-08-09T10:00:00+08:00",
      description: "准备材料",
      timezone: "Asia/Shanghai",
    },
  });

  assert.equal(listed.events[0].id, "evt-list");
  assert.equal(listed.events[0].summary, "客户沟通");
  assert.equal(created.eventId, "evt-created");
  assert.deepEqual(calls[0], {
    args: [
      "calendar", "event", "list",
      "--start", "2026-08-09T00:00:00+08:00",
      "--end", "2026-08-10T00:00:00+08:00",
    ],
    options: { write: false },
  });
  assert.deepEqual(calls[1], {
    args: [
      "calendar", "event", "create",
      "--title", "客户沟通",
      "--start", "2026-08-09T09:00:00+08:00",
      "--end", "2026-08-09T10:00:00+08:00",
      "--desc", "准备材料",
      "--timezone", "Asia/Shanghai",
    ],
    options: { write: true },
  });
});

test("GetEvent passes stable IDs and profile and normalizes CalendarEvent", async () => {
  const { calls, handlers } = createHarness([{
    success: true,
    data: {
      result: {
        id: "evt-get",
        summary: "项目复盘",
        start: { dateTime: "2026-08-09T13:00:00+08:00" },
        end: { dateTime: "2026-08-09T14:00:00+08:00" },
        description: "复盘要点",
        status: "cancelled",
      },
    },
  }]);

  const result = await handlers["dingtalk.calendar.v1.CalendarService/GetEvent"]({
    request: { eventId: "evt-get", calendarId: "primary", profile: "corp-a:user-a" },
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.event, {
    id: "evt-get",
    summary: "项目复盘",
    start: "2026-08-09T13:00:00+08:00",
    end: "2026-08-09T14:00:00+08:00",
    isAllDay: false,
    description: "复盘要点",
    location: "",
    attendees: [],
    status: "cancelled",
  });
  assert.deepEqual(calls, [{
    args: [
      "calendar", "event", "get", "--id", "evt-get",
      "--calendar-id", "primary", "--profile", "corp-a:user-a",
    ],
    options: { write: false },
  }]);
});

test("GetEvent preserves stable attendee IDs for mutation readback", async () => {
  const { handlers } = createHarness([{
    success: true,
    data: {
      result: {
        id: "evt-get",
        attendees: [
          { userId: "staff-1", displayName: "参与人甲" },
          { id: "staff-2", name: "参与人乙" },
          { displayName: "仅名称兼容" },
        ],
      },
    },
  }]);

  const result = await handlers["dingtalk.calendar.v1.CalendarService/GetEvent"]({
    request: { eventId: "evt-get", calendarId: "primary", profile: "corp-a:user-a" },
  });

  assert.deepEqual(result.event.attendees, ["staff-1", "staff-2", "仅名称兼容"]);
});

test("ListEvents passes an explicit profile without changing profile-optional compatibility", async () => {
  const { calls, handlers } = createHarness([{ success: true, data: { result: { events: [] } } }]);

  await handlers["dingtalk.calendar.v1.CalendarService/ListEvents"]({
    request: {
      start: "2026-08-09T00:00:00+08:00",
      end: "2026-08-10T00:00:00+08:00",
      profile: "corp-a:user-a",
    },
  });

  assert.deepEqual(calls[0], {
    args: [
      "calendar", "event", "list",
      "--start", "2026-08-09T00:00:00+08:00",
      "--end", "2026-08-10T00:00:00+08:00",
      "--profile", "corp-a:user-a",
    ],
    options: { write: false },
  });
});

test("UpdateEvent maps only present patch flags and invokes DWS once", async () => {
  const { calls, handlers } = createHarness([{
    success: true,
    data: { result: { id: "evt-update" } },
  }]);

  const result = await handlers["dingtalk.calendar.v1.CalendarService/UpdateEvent"]({
    request: {
      eventId: "evt-update",
      calendarId: "primary",
      profile: "corp-a:user-a",
      title: "更新后的标题",
      description: "",
      timezone: "Asia/Shanghai",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.eventId, "evt-update");
  assert.deepEqual(calls, [{
    args: [
      "calendar", "event", "update", "--id", "evt-update",
      "--calendar-id", "primary", "--title", "更新后的标题",
      "--desc", "", "--timezone", "Asia/Shanghai",
      "--profile", "corp-a:user-a",
    ],
    options: { write: true },
  }]);
});

test("UpdateEvent validates stable identity and patch before any write", async () => {
  const invalidRequests = [
    { eventId: "", calendarId: "primary", profile: "corp-a:user-a", title: "新标题" },
    { eventId: "evt", calendarId: "primary", profile: "", title: "新标题" },
    { eventId: "evt", calendarId: "primary", profile: "corp-a", title: "新标题" },
    { eventId: "evt", calendarId: "primary", profile: "corp-a:user-a" },
    { eventId: "evt", calendarId: "primary", profile: "corp-a:user-a", title: undefined },
    { eventId: "evt", calendarId: "primary", profile: "corp-a:user-a", start: "2026-08-09T10:00:00+08:00" },
    {
      eventId: "evt",
      calendarId: "primary",
      profile: "corp-a:user-a",
      start: "2026-08-09T11:00:00+08:00",
      end: "2026-08-09T10:00:00+08:00",
    },
  ];

  for (const request of invalidRequests) {
    const { calls, handlers } = createHarness();
    const result = await handlers["dingtalk.calendar.v1.CalendarService/UpdateEvent"]({ request });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_ARGUMENT");
    assert.equal(result.outcomeUncertain, false);
    assert.equal(calls.length, 0);
  }
});

test("DeleteEvent requires stable identity and invokes DWS once", async () => {
  const valid = createHarness([{ success: true, data: { result: { id: "evt-delete" } } }]);
  const result = await valid.handlers["dingtalk.calendar.v1.CalendarService/DeleteEvent"]({
    request: { eventId: "evt-delete", calendarId: "primary", profile: "corp-a:user-a" },
  });

  assert.equal(result.success, true);
  assert.equal(result.eventId, "evt-delete");
  assert.deepEqual(valid.calls, [{
    args: [
      "calendar", "event", "delete", "--id", "evt-delete",
      "--calendar-id", "primary", "--profile", "corp-a:user-a",
    ],
    options: { write: true },
  }]);

  const invalid = createHarness();
  const rejected = await invalid.handlers["dingtalk.calendar.v1.CalendarService/DeleteEvent"]({
    request: { eventId: "evt-delete", calendarId: "primary", profile: "" },
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorCode, "INVALID_ARGUMENT");
  assert.equal(invalid.calls.length, 0);
});

test("Update/Delete propagate transport uncertainty without replay", async () => {
  for (const method of ["UpdateEvent", "DeleteEvent"]) {
    const harness = createHarness([{
      success: false,
      error: "Calendar write result is uncertain",
      errorCode: "DWS_TIMEOUT",
      outcomeUncertain: true,
    }]);
    const request = {
      eventId: `evt-${method}`,
      calendarId: "primary",
      profile: "corp-a:user-a",
      ...(method === "UpdateEvent" ? { title: "新标题" } : {}),
    };

    const result = await harness.handlers[`dingtalk.calendar.v1.CalendarService/${method}`]({ request });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "DWS_TIMEOUT");
    assert.equal(result.outcomeUncertain, true);
    assert.equal(harness.calls.length, 1);
  }
});

test("AddEventAttendees maps stable identity and attendee IDs to DWS once", async () => {
  const harness = createHarness([{ success: true, data: { result: {} } }]);
  const result = await harness.handlers[
    "dingtalk.calendar.v1.CalendarService/AddEventAttendees"
  ]({
    request: {
      eventId: "evt-attendee",
      calendarId: "primary",
      profile: "corp-a:user-a",
      attendeesToAdd: ["staff-1", "staff-2"],
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.eventId, "evt-attendee");
  assert.deepEqual(harness.calls, [{
    args: [
      "calendar", "attendee", "add", "--event", "evt-attendee",
      "--attendees", "staff-1,staff-2", "--calendar-id", "primary",
      "--profile", "corp-a:user-a",
    ],
    options: { write: true },
  }]);
});

test("RemoveEventAttendees maps stable identity and attendee IDs to DWS once", async () => {
  const harness = createHarness([{ success: true, data: { result: {} } }]);
  const result = await harness.handlers[
    "dingtalk.calendar.v1.CalendarService/RemoveEventAttendees"
  ]({
    request: {
      eventId: "evt-attendee",
      calendarId: "primary",
      profile: "corp-a:user-a",
      attendeesToRemove: ["staff-2"],
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.eventId, "evt-attendee");
  assert.deepEqual(harness.calls, [{
    args: [
      "calendar", "attendee", "delete", "--event", "evt-attendee",
      "--attendees", "staff-2", "--calendar-id", "primary",
      "--profile", "corp-a:user-a",
    ],
    options: { write: true },
  }]);
});

test("attendee mutations validate identity and non-empty stable attendee IDs", async () => {
  for (const method of ["AddEventAttendees", "RemoveEventAttendees"]) {
    for (const request of [
      { eventId: "", calendarId: "primary", profile: "corp-a:user-a", attendeesToAdd: ["staff-1"], attendeesToRemove: ["staff-1"] },
      { eventId: "evt", calendarId: "primary", profile: "", attendeesToAdd: ["staff-1"], attendeesToRemove: ["staff-1"] },
      { eventId: "evt", calendarId: "primary", profile: "corp-a:user-a", attendeesToAdd: [], attendeesToRemove: [] },
      { eventId: "evt", calendarId: "primary", profile: "corp-a:user-a", attendeesToAdd: [""], attendeesToRemove: [""] },
    ]) {
      const harness = createHarness();
      const result = await harness.handlers[
        `dingtalk.calendar.v1.CalendarService/${method}`
      ]({ request });
      assert.equal(result.success, false);
      assert.equal(result.errorCode, "INVALID_ARGUMENT");
      assert.equal(result.outcomeUncertain, false);
      assert.equal(harness.calls.length, 0);
    }
  }
});

test("attendee mutation transport uncertainty is returned without replay", async () => {
  for (const method of ["AddEventAttendees", "RemoveEventAttendees"]) {
    const harness = createHarness([{
      success: false,
      error: "Calendar attendee write result is uncertain",
      errorCode: "DWS_TIMEOUT",
      outcomeUncertain: true,
    }]);
    const attendeeField = method === "AddEventAttendees"
      ? { attendeesToAdd: ["staff-1"] }
      : { attendeesToRemove: ["staff-1"] };
    const result = await harness.handlers[
      `dingtalk.calendar.v1.CalendarService/${method}`
    ]({
      request: {
        eventId: "evt-attendee",
        calendarId: "primary",
        profile: "corp-a:user-a",
        ...attendeeField,
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "DWS_TIMEOUT");
    assert.equal(result.outcomeUncertain, true);
    assert.equal(harness.calls.length, 1);
  }
});

test("SearchRooms maps a stable profile and exact time window to DWS", async () => {
  const harness = createHarness([{
    success: true,
    data: {
      result: {
        rooms: [{
          roomId: "room-17",
          name: "机器人测试会议室",
          groupId: "group-1",
          customApprovalProcess: false,
          supportRecurring: true,
        }],
      },
    },
  }]);

  const result = await harness.handlers[
    "dingtalk.calendar.v1.CalendarService/SearchRooms"
  ]({
    request: {
      start: "2026-08-18T14:00:00+08:00",
      end: "2026-08-18T15:00:00+08:00",
      profile: "corp-a:user-a",
      roomName: "机器人测试",
      groupId: "group-1",
    },
  });

  assert.deepEqual(result.rooms, [{
    roomId: "room-17",
    name: "机器人测试会议室",
    groupId: "group-1",
    customApprovalProcess: false,
    supportRecurring: true,
  }]);
  assert.deepEqual(harness.calls, [{
    args: [
      "calendar", "room", "search",
      "--start", "2026-08-18T14:00:00+08:00",
      "--end", "2026-08-18T15:00:00+08:00",
      "--room-name", "机器人测试",
      "--group-id", "group-1",
      "--profile", "corp-a:user-a",
    ],
    options: { write: false },
  }]);
});

test("QueryRoomBusy requires room IDs and returns the exact DWS result", async () => {
  const busyResult = { schedules: [{ eventId: "event-17" }] };
  const harness = createHarness([{
    success: true,
    data: { result: busyResult },
  }]);

  const result = await harness.handlers[
    "dingtalk.calendar.v1.CalendarService/QueryRoomBusy"
  ]({
    request: {
      start: "2026-08-18T14:00:00+08:00",
      end: "2026-08-18T15:00:00+08:00",
      profile: "corp-a:user-a",
      roomIds: ["room-17"],
    },
  });

  assert.equal(result.rawJson, JSON.stringify(busyResult));
  assert.deepEqual(harness.calls, [{
    args: [
      "calendar", "busy", "search",
      "--rooms", "room-17",
      "--start", "2026-08-18T14:00:00+08:00",
      "--end", "2026-08-18T15:00:00+08:00",
      "--profile", "corp-a:user-a",
    ],
    options: { write: false },
  }]);
});

test("room mutations use stable IDs and invoke DWS exactly once", async () => {
  for (const [method, command] of [
    ["AddEventRooms", "add"],
    ["RemoveEventRooms", "delete"],
  ]) {
    const harness = createHarness([{ success: true, data: { result: {} } }]);
    const result = await harness.handlers[
      `dingtalk.calendar.v1.CalendarService/${method}`
    ]({
      request: {
        eventId: "event-17",
        calendarId: "primary",
        profile: "corp-a:user-a",
        roomIds: ["room-17"],
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.eventId, "event-17");
    assert.deepEqual(harness.calls, [{
      args: [
        "calendar", "room", command,
        "--event", "event-17",
        "--rooms", "room-17",
        "--calendar-id", "primary",
        "--profile", "corp-a:user-a",
      ],
      options: { write: true },
    }]);
  }
});

test("room operations reject incomplete stable context before DWS", async () => {
  for (const [method, request] of [
    ["SearchRooms", { start: "2026-08-18T14:00:00+08:00", profile: "corp-a:user-a" }],
    ["QueryRoomBusy", { start: "2026-08-18T14:00:00+08:00", end: "2026-08-18T15:00:00+08:00", profile: "corp-a:user-a", roomIds: [] }],
    ["AddEventRooms", { eventId: "event-17", calendarId: "primary", profile: "", roomIds: ["room-17"] }],
    ["RemoveEventRooms", { eventId: "event-17", calendarId: "primary", profile: "corp-a:user-a", roomIds: [] }],
  ]) {
    const harness = createHarness();
    const result = await harness.handlers[
      `dingtalk.calendar.v1.CalendarService/${method}`
    ]({ request });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_ARGUMENT");
    assert.equal(harness.calls.length, 0);
  }
});
