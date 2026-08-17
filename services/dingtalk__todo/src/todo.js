import { addFlag, requireValue } from "../lib/dws.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const isPresent = (value, key) => hasOwn(value, key) && value[key] !== undefined && value[key] !== null;

function resultPayload(response) {
  return response.data?.result ?? response.data;
}

function normalizeTodo(value) {
  const todo = value?.todo ?? value ?? {};
  const dueDate = todo.dueTime ?? todo.dueDate ?? "";
  return {
    todoId: String(todo.id ?? todo.taskId ?? todo.todoId ?? todo.todo_id ?? ""),
    title: String(todo.subject ?? todo.title ?? ""),
    description: String(todo.description ?? ""),
    isDone: todo.done === true || todo.isDone === true,
    dueDate: String(dueDate ?? ""),
    createdAt: String(todo.createdTime ?? todo.createdAt ?? ""),
    priority: Number(todo.priority ?? 0),
  };
}

function validationFailure(message) {
  return {
    success: false,
    todoId: "",
    error: message,
    errorCode: "INVALID_ARGUMENT",
    outcomeUncertain: false,
  };
}

function upstreamFailure(response) {
  return {
    success: false,
    todoId: "",
    error: response.error,
    errorCode: response.errorCode || "DWS_OPERATION_FAILED",
    outcomeUncertain: response.outcomeUncertain === true,
  };
}

function validateIdentity(request) {
  try {
    const todoId = requireValue(request?.todoId, "todo_id");
    const profile = requireValue(request?.profile, "profile");
    const parts = profile.split(":");
    if (parts.length !== 2 || parts.some((part) => part.trim() === "" || /\s/.test(part))) {
      throw new Error("profile must use corpId:userId format");
    }
    return { todoId, profile };
  } catch (error) {
    return validationFailure(error.message);
  }
}

export function createTodoHandlers({ runDws }) {
  return {
    "dingtalk.todo.v1.TodoService/CreateTodo": async (ctx) => {
      const { title, description, dueDate, assigneeId } = ctx.request;
      const displayTitle = description
        ? `${title || "Untitled"} (${description})`
        : requireValue(title || "Untitled", "title");
      const args = ["todo", "task", "create", "--title", displayTitle];
      addFlag(args, "--due", dueDate);
      const executor = assigneeId || process.env.USER_ID || "default";
      if (!assigneeId && !process.env.USER_ID) {
        console.warn('[dingtalk-todo] assigneeId not provided and USER_ID not set, using "default"');
      }
      args.push("--executors", executor);

      const response = await runDws(ctx, args);
      if (!response.success) return { success: false, todoId: "", error: response.error };

      const result = response.data?.result || response.data;
      const todoId = Array.isArray(result) && result.length > 0
        ? (result[0].id || result[0].taskId || "")
        : "";
      return { success: true, todoId, error: "" };
    },

    "dingtalk.todo.v1.TodoService/ListTodos": async (ctx) => {
      const { isDone, startAt, endAt } = ctx.request;
      const requestedLimit = ctx.request.fetchLimit || ctx.request.limit || 500;
      const fetchLimit = Math.max(1, Number(requestedLimit));
      const args = [
        "todo", "task", "list", "--size", String(fetchLimit),
        "--status", isDone ? "true" : "false",
      ];

      const response = await runDws(ctx, args);
      if (!response.success) {
        return {
          success: false,
          todos: [],
          complete: false,
          fetchedCount: 0,
          excludedWithoutDueAt: 0,
          rangeStart: startAt || "",
          rangeEnd: endAt || "",
          error: response.error,
        };
      }

      const raw = response.data?.result?.todoList
        || response.data?.result
        || response.data?.todoList
        || [];
      const list = Array.isArray(raw) ? raw : [];
      const hasRange = Boolean(startAt && endAt);
      const start = hasRange ? Date.parse(startAt) : Number.NEGATIVE_INFINITY;
      const end = hasRange ? Date.parse(endAt) : Number.POSITIVE_INFINITY;
      let excludedWithoutDueAt = 0;

      const todos = list.flatMap((item) => {
        const dueDate = item.dueTime ?? item.dueDate ?? "";
        if (hasRange && (dueDate === "" || dueDate === null)) {
          excludedWithoutDueAt += 1;
          return [];
        }
        const due = typeof dueDate === "number" ? dueDate : Date.parse(dueDate);
        if (hasRange && (!Number.isFinite(due) || due < start || due >= end)) {
          if (!Number.isFinite(due)) excludedWithoutDueAt += 1;
          return [];
        }
        return [{
          todoId: item.id || item.taskId || "",
          title: item.subject || item.title || "",
          description: item.description || "",
          isDone: item.done === true || item.isDone === true,
          dueDate: String(dueDate || ""),
          createdAt: String(item.createdTime || item.createdAt || ""),
        }];
      });

      return {
        success: true,
        todos,
        complete: list.length < fetchLimit,
        fetchedCount: list.length,
        excludedWithoutDueAt,
        rangeStart: startAt || "",
        rangeEnd: endAt || "",
        error: "",
      };
    },

    "dingtalk.todo.v1.TodoService/MarkDone": async (ctx) => {
      const { keyword } = ctx.request;
      const listResponse = await runDws(
        ctx,
        ["todo", "task", "list", "--status", "false", "--size", "50"],
      );
      if (!listResponse.success) {
        return { success: false, matchedCount: 0, error: listResponse.error };
      }

      const raw = listResponse.data?.result?.todoList || listResponse.data?.result || [];
      const list = Array.isArray(raw) ? raw : [];
      let matchedCount = 0;
      for (const item of list) {
        const subject = item.subject || item.title || "";
        if (keyword && subject.includes(keyword)) {
          const todoId = item.id || item.taskId;
          if (todoId) {
            await runDws(
              ctx,
              ["todo", "task", "update", "--task-id", todoId, "--done", "true"],
            );
            matchedCount += 1;
          }
        }
      }
      return { success: true, matchedCount, error: "" };
    },

    "dingtalk.todo.v1.TodoService/GetTodo": async (ctx) => {
      const identity = validateIdentity(ctx.request);
      if (identity.success === false) return { ...identity, todo: undefined };
      const response = await runDws(
        ctx,
        [
          "todo", "task", "get", "--task-id", identity.todoId,
          "--profile", identity.profile,
        ],
        { write: false },
      );
      if (!response.success) return { ...upstreamFailure(response), todo: undefined };
      return {
        success: true,
        todo: normalizeTodo(resultPayload(response)),
        error: "",
        errorCode: "",
      };
    },

    "dingtalk.todo.v1.TodoService/UpdateTodo": async (ctx) => {
      const request = ctx.request ?? {};
      const identity = validateIdentity(request);
      if (identity.success === false) return identity;
      const patchFields = ["title", "dueDate", "priority"];
      if (!patchFields.some((field) => isPresent(request, field))) {
        return validationFailure("at least one update field is required");
      }
      if (isPresent(request, "priority") && ![10, 20, 30, 40].includes(Number(request.priority))) {
        return validationFailure("priority must be one of 10, 20, 30, or 40");
      }
      const args = ["todo", "task", "update", "--task-id", identity.todoId];
      if (isPresent(request, "title")) args.push("--title", String(request.title));
      if (isPresent(request, "dueDate")) args.push("--due", String(request.dueDate));
      if (isPresent(request, "priority")) args.push("--priority", String(request.priority));
      args.push("--profile", identity.profile);
      const response = await runDws(ctx, args, { write: true });
      if (!response.success) return upstreamFailure(response);
      return {
        success: true,
        todoId: identity.todoId,
        error: "",
        errorCode: "",
        outcomeUncertain: false,
      };
    },

    "dingtalk.todo.v1.TodoService/DeleteTodo": async (ctx) => {
      const identity = validateIdentity(ctx.request);
      if (identity.success === false) return identity;
      const response = await runDws(
        ctx,
        [
          "todo", "task", "delete", "--task-id", identity.todoId,
          "--profile", identity.profile,
        ],
        { write: true },
      );
      if (!response.success) return upstreamFailure(response);
      return {
        success: true,
        todoId: identity.todoId,
        error: "",
        errorCode: "",
        outcomeUncertain: false,
      };
    },
  };
}
