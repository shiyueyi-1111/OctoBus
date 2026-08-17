import { requireValue } from "../lib/dws.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const isPresent = (value, key) => hasOwn(value, key) && value[key] !== undefined && value[key] !== null;

function normalizeEvent(value) {
  const event = value?.event ?? value ?? {};
  return {
    id: String(event.id ?? event.eventId ?? ""),
    summary: String(event.summary ?? event.title ?? ""),
    start: String(event.start?.dateTime ?? event.start ?? ""),
    end: String(event.end?.dateTime ?? event.end ?? ""),
    isAllDay: event.isAllDay === true,
    description: String(event.description ?? ""),
    location: String(event.location?.displayName ?? event.location ?? ""),
    attendees: Array.isArray(event.attendees)
      ? event.attendees.map((attendee) => String(
        attendee?.userId ?? attendee?.id ?? attendee?.openDingTalkId
        ?? attendee?.displayName ?? attendee?.name ?? attendee ?? "",
      ))
      : [],
    status: String(event.status ?? ""),
  };
}

function resultPayload(response) {
  return response.data?.result ?? response.data;
}

function validationFailure(message) {
  return {
    success: false,
    eventId: "",
    error: message,
    errorCode: "INVALID_ARGUMENT",
    outcomeUncertain: false,
  };
}

function upstreamFailure(response) {
  return {
    success: false,
    eventId: "",
    error: response.error,
    errorCode: response.errorCode || "DWS_OPERATION_FAILED",
    outcomeUncertain: response.outcomeUncertain === true,
  };
}

function validateIdentity(request) {
  const { eventId, profile, calendarId } = request ?? {};
  try {
    const stableProfile = requireValue(profile, "profile");
    const profileParts = stableProfile.split(":");
    if (
      profileParts.length !== 2
      || profileParts.some((part) => part.trim() === "" || /\s/.test(part))
    ) {
      throw new Error("profile must use corpId:userId format");
    }
    return {
      eventId: requireValue(eventId, "event_id"),
      profile: stableProfile,
      calendarId: String(calendarId ?? ""),
    };
  } catch (error) {
    return validationFailure(error.message);
  }
}

function validateProfile(value) {
  try {
    const profile = requireValue(value, "profile");
    const parts = profile.split(":");
    if (parts.length !== 2 || parts.some((part) => part.trim() === "" || /\s/.test(part))) {
      throw new Error("profile must use corpId:userId format");
    }
    return { profile };
  } catch (error) {
    return validationFailure(error.message);
  }
}

function validateTimeWindow(start, end, { required = false } = {}) {
  const hasStart = String(start ?? "").trim() !== "";
  const hasEnd = String(end ?? "").trim() !== "";
  if ((required && (!hasStart || !hasEnd)) || hasStart !== hasEnd) {
    return validationFailure("start and end must be provided together");
  }
  if (hasStart) {
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
      return validationFailure("start and end must be valid and start must be before end");
    }
  }
  return { start: hasStart ? String(start) : "", end: hasEnd ? String(end) : "" };
}

function normalizedIds(values, field) {
  const ids = Array.isArray(values) ? values.map((value) => String(value).trim()) : [];
  if (ids.length === 0 || ids.some((value) => value === "")) {
    return validationFailure(`${field} must contain stable IDs`);
  }
  return { ids };
}

function normalizeRoom(value) {
  const room = value?.room ?? value ?? {};
  return {
    roomId: String(room.roomId ?? room.room_id ?? room.id ?? ""),
    name: String(room.name ?? room.roomName ?? room.room_name ?? ""),
    groupId: String(room.groupId ?? room.group_id ?? ""),
    customApprovalProcess: room.customApprovalProcess === true || room.custom_approval_process === true,
    supportRecurring: room.supportRecurring === true || room.support_recurring === true,
  };
}

async function mutateRooms(ctx, runDws, command) {
  const identity = validateIdentity(ctx.request);
  if (identity.success === false) return identity;
  const roomIds = normalizedIds(ctx.request?.roomIds, "room_ids");
  if (roomIds.success === false) return roomIds;
  const response = await runDws(
    ctx,
    [
      "calendar", "room", command,
      "--event", identity.eventId,
      "--rooms", roomIds.ids.join(","),
      "--calendar-id", identity.calendarId,
      "--profile", identity.profile,
    ],
    { write: true },
  );
  if (!response.success) return upstreamFailure(response);
  return {
    success: true,
    eventId: identity.eventId,
    error: "",
    errorCode: "",
    outcomeUncertain: false,
  };
}

function addPresentFlag(args, request, key, flag) {
  if (isPresent(request, key)) args.push(flag, String(request[key]));
}

async function mutateAttendees(ctx, runDws, { requestField, command }) {
  const request = ctx.request ?? {};
  const identity = validateIdentity(request);
  if (identity.success === false) return identity;
  const attendees = Array.isArray(request[requestField])
    ? request[requestField].map((value) => String(value).trim())
    : [];
  if (attendees.length === 0 || attendees.some((value) => value === "")) {
    return validationFailure(`${requestField} must contain stable attendee IDs`);
  }
  const response = await runDws(
    ctx,
    [
      "calendar", "attendee", command, "--event", identity.eventId,
      "--attendees", attendees.join(","), "--calendar-id", identity.calendarId,
      "--profile", identity.profile,
    ],
    { write: true },
  );
  if (!response.success) return upstreamFailure(response);
  return {
    success: true,
    eventId: identity.eventId,
    error: "",
    errorCode: "",
    outcomeUncertain: false,
  };
}

export function createCalendarHandlers({ runDws }) {
  return {
    "dingtalk.calendar.v1.CalendarService/ListEvents": async (ctx) => {
      const { start, end, profile } = ctx.request ?? {};
      const args = ["calendar", "event", "list", "--start", start || "", "--end", end || ""];
      if (profile) {
        const stableProfile = String(profile).trim();
        const profileParts = stableProfile.split(":");
        if (
          profileParts.length !== 2
          || profileParts.some((part) => part.trim() === "" || /\s/.test(part))
        ) {
          return { success: false, events: [], error: "profile must use corpId:userId format" };
        }
        args.push("--profile", stableProfile);
      }
      const response = await runDws(
        ctx,
        args,
        { write: false },
      );
      if (!response.success) return { success: false, events: [], error: response.error };

      const rawEvents = response.data?.result?.events ?? response.data?.events ?? [];
      const events = Array.isArray(rawEvents) ? rawEvents.map(normalizeEvent) : [];
      return { success: true, events, error: "" };
    },

    "dingtalk.calendar.v1.CalendarService/CreateEvent": async (ctx) => {
      const request = ctx.request ?? {};
      if (request.location) {
        return {
          success: false,
          eventId: "",
          error: "Current dws calendar event create CLI does not support location.",
        };
      }
      const args = [
        "calendar", "event", "create",
        "--title", request.title || "Untitled",
        "--start", request.start || "",
        "--end", request.end || "",
      ];
      if (Array.isArray(request.attendees) && request.attendees.length > 0) {
        args.push("--attendees", request.attendees.join(","));
      }
      if (Array.isArray(request.openDingtalkIds) && request.openDingtalkIds.length > 0) {
        args.push("--open-dingtalk-ids", request.openDingtalkIds.join(","));
      }
      if (request.description) args.push("--desc", request.description);
      if (request.timezone) args.push("--timezone", request.timezone);

      const response = await runDws(ctx, args, { write: true });
      if (!response.success) return { success: false, eventId: "", error: response.error };
      const result = resultPayload(response);
      const eventId = result?.id ?? result?.eventId ?? (Array.isArray(result) ? result[0]?.id : "") ?? "";
      return { success: true, eventId: String(eventId), error: "" };
    },

    "dingtalk.calendar.v1.CalendarService/GetEvent": async (ctx) => {
      const identity = validateIdentity(ctx.request);
      if (identity.success === false) {
        return { ...identity, event: undefined };
      }
      const response = await runDws(
        ctx,
        [
          "calendar", "event", "get", "--id", identity.eventId,
          "--calendar-id", identity.calendarId, "--profile", identity.profile,
        ],
        { write: false },
      );
      if (!response.success) {
        const failure = upstreamFailure(response);
        return { ...failure, event: undefined };
      }
      return { success: true, event: normalizeEvent(resultPayload(response)), error: "", errorCode: "" };
    },

    "dingtalk.calendar.v1.CalendarService/UpdateEvent": async (ctx) => {
      const request = ctx.request ?? {};
      const identity = validateIdentity(request);
      if (identity.success === false) return identity;

      const patchKeys = ["title", "start", "end", "description", "timezone"];
      if (!patchKeys.some((key) => isPresent(request, key))) {
        return validationFailure("at least one update field is required");
      }
      const hasStart = isPresent(request, "start");
      const hasEnd = isPresent(request, "end");
      if (hasStart !== hasEnd) return validationFailure("start and end must be provided together");
      if (hasStart) {
        const start = Date.parse(request.start);
        const end = Date.parse(request.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
          return validationFailure("start and end must be valid and start must be before end");
        }
      }

      const args = [
        "calendar", "event", "update", "--id", identity.eventId,
        "--calendar-id", identity.calendarId,
      ];
      addPresentFlag(args, request, "title", "--title");
      addPresentFlag(args, request, "start", "--start");
      addPresentFlag(args, request, "end", "--end");
      addPresentFlag(args, request, "description", "--desc");
      addPresentFlag(args, request, "timezone", "--timezone");
      args.push("--profile", identity.profile);

      const response = await runDws(ctx, args, { write: true });
      if (!response.success) return upstreamFailure(response);
      return {
        success: true,
        eventId: identity.eventId,
        error: "",
        errorCode: "",
        outcomeUncertain: false,
      };
    },

    "dingtalk.calendar.v1.CalendarService/DeleteEvent": async (ctx) => {
      const identity = validateIdentity(ctx.request);
      if (identity.success === false) return identity;
      const response = await runDws(
        ctx,
        [
          "calendar", "event", "delete", "--id", identity.eventId,
          "--calendar-id", identity.calendarId, "--profile", identity.profile,
        ],
        { write: true },
      );
      if (!response.success) return upstreamFailure(response);
      return {
        success: true,
        eventId: identity.eventId,
        error: "",
        errorCode: "",
        outcomeUncertain: false,
      };
    },

    "dingtalk.calendar.v1.CalendarService/AddEventAttendees": async (ctx) =>
      mutateAttendees(ctx, runDws, {
        requestField: "attendeesToAdd",
        command: "add",
      }),

    "dingtalk.calendar.v1.CalendarService/RemoveEventAttendees": async (ctx) =>
      mutateAttendees(ctx, runDws, {
        requestField: "attendeesToRemove",
        command: "delete",
      }),

    "dingtalk.calendar.v1.CalendarService/SearchRooms": async (ctx) => {
      const request = ctx.request ?? {};
      const profile = validateProfile(request.profile);
      if (profile.success === false) return { ...profile, rooms: [] };
      const window = validateTimeWindow(request.start, request.end);
      if (window.success === false) return { ...window, rooms: [] };
      const args = ["calendar", "room", "search"];
      if (window.start) args.push("--start", window.start, "--end", window.end);
      if (String(request.roomName ?? "").trim()) {
        args.push("--room-name", String(request.roomName).trim());
      }
      if (String(request.groupId ?? "").trim()) {
        args.push("--group-id", String(request.groupId).trim());
      }
      args.push("--profile", profile.profile);
      const response = await runDws(ctx, args, { write: false });
      if (!response.success) return { ...upstreamFailure(response), rooms: [] };
      const result = resultPayload(response);
      const rawRooms = result?.rooms ?? result?.items ?? result?.result ?? result ?? [];
      const rooms = Array.isArray(rawRooms)
        ? rawRooms.map(normalizeRoom).filter((room) => room.roomId !== "")
        : [];
      return { success: true, rooms, error: "", errorCode: "" };
    },

    "dingtalk.calendar.v1.CalendarService/QueryRoomBusy": async (ctx) => {
      const request = ctx.request ?? {};
      const profile = validateProfile(request.profile);
      if (profile.success === false) return { ...profile, rawJson: "" };
      const window = validateTimeWindow(request.start, request.end, { required: true });
      if (window.success === false) return { ...window, rawJson: "" };
      const roomIds = normalizedIds(request.roomIds, "room_ids");
      if (roomIds.success === false) return { ...roomIds, rawJson: "" };
      const response = await runDws(
        ctx,
        [
          "calendar", "busy", "search",
          "--rooms", roomIds.ids.join(","),
          "--start", window.start,
          "--end", window.end,
          "--profile", profile.profile,
        ],
        { write: false },
      );
      if (!response.success) return { ...upstreamFailure(response), rawJson: "" };
      return {
        success: true,
        rawJson: JSON.stringify(resultPayload(response) ?? {}),
        error: "",
        errorCode: "",
      };
    },

    "dingtalk.calendar.v1.CalendarService/AddEventRooms": async (ctx) =>
      mutateRooms(ctx, runDws, "add"),

    "dingtalk.calendar.v1.CalendarService/RemoveEventRooms": async (ctx) =>
      mutateRooms(ctx, runDws, "delete"),
  };
}
