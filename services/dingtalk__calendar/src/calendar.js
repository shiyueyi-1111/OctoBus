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
      ? event.attendees.map((attendee) => String(attendee?.displayName ?? attendee?.name ?? attendee ?? ""))
      : [],
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

function addPresentFlag(args, request, key, flag) {
  if (isPresent(request, key)) args.push(flag, String(request[key]));
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
  };
}
