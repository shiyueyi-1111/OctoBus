import test from "node:test";
import assert from "node:assert/strict";

import { createTodoHandlers } from "../src/todo.js";

test("CreateTodo returns the task ID from the current object-shaped DWS response", async () => {
  const handlers = createTodoHandlers({
    runDws: async () => ({
      success: true,
      data: {
        success: true,
        result: {
          subject: "机器人测试客户回访",
          taskId: "todo-current-created-1",
        },
      },
    }),
  });

  const created = await handlers["dingtalk.todo.v1.TodoService/CreateTodo"]({
    request: { title: "机器人测试客户回访", assigneeId: "user-a" },
  });

  assert.equal(created.success, true);
  assert.equal(created.todoId, "todo-current-created-1");
});

test("CreateTodo preserves profile-optional compatibility and forwards an explicit profile", async () => {
  const calls = [];
  const handlers = createTodoHandlers({
    runDws: async (_ctx, args) => {
      calls.push(args);
      return { success: true, data: { result: [{ id: "todo-created" }] } };
    },
  });

  const created = await handlers["dingtalk.todo.v1.TodoService/CreateTodo"]({
    request: { title: "机器人测试回访", assigneeId: "user-a" },
  });
  assert.equal(created.success, true);
  assert.equal(created.todoId, "todo-created");
  assert.deepEqual(calls, [[
    "todo", "task", "create", "--title", "机器人测试回访",
    "--executors", "user-a",
  ]]);

  await handlers["dingtalk.todo.v1.TodoService/CreateTodo"]({
    request: {
      title: "机器人测试回访",
      assigneeId: "user-a",
      profile: "corp-a:user-a",
    },
  });
  assert.deepEqual(calls[1], [
    "todo", "task", "create", "--title", "机器人测试回访",
    "--executors", "user-a", "--profile", "corp-a:user-a",
  ]);

  const rejected = await handlers["dingtalk.todo.v1.TodoService/CreateTodo"]({
    request: {
      title: "机器人测试回访",
      assigneeId: "user-a",
      profile: "corp-a",
    },
  });
  assert.equal(rejected.success, false);
  assert.equal(calls.length, 2);

  const whitespaceCalls = [];
  const whitespaceHandlers = createTodoHandlers({
    runDws: async (_ctx, args) => {
      whitespaceCalls.push(args);
      return { success: true, data: { result: [{ id: "todo-created" }] } };
    },
  });
  const whitespaceRejected = await whitespaceHandlers[
    "dingtalk.todo.v1.TodoService/CreateTodo"
  ]({
    request: {
      title: "机器人测试回访",
      assigneeId: "user-a",
      profile: "   ",
    },
  });
  assert.equal(whitespaceRejected.success, false);
  assert.equal(whitespaceCalls.length, 0);
});


test("ListTodos filters a half-open range and reports completeness", async () => {
  const calls = [];
  const runDws = async (_ctx, args) => {
    calls.push(args);
    return {
      success: true,
      data: {
        result: {
          todoList: [
            { id: "a", subject: "inside", done: false, dueTime: "2026-07-06T09:00:00+08:00" },
            { id: "b", subject: "end", done: false, dueTime: "2026-07-13T00:00:00+08:00" },
            { id: "c", subject: "no due", done: false },
          ],
        },
      },
    };
  };
  const handlers = createTodoHandlers({ runDws });

  const result = await handlers["dingtalk.todo.v1.TodoService/ListTodos"]({
    request: {
      isDone: false,
      startAt: "2026-07-06T00:00:00+08:00",
      endAt: "2026-07-13T00:00:00+08:00",
      fetchLimit: 500,
    },
  });

  assert.deepEqual(result.todos.map((item) => item.todoId), ["a"]);
  assert.equal(result.excludedWithoutDueAt, 1);
  assert.equal(result.fetchedCount, 3);
  assert.equal(result.complete, true);
  assert.equal(result.rangeStart, "2026-07-06T00:00:00+08:00");
  assert.equal(result.rangeEnd, "2026-07-13T00:00:00+08:00");
  assert.deepEqual(calls, [["todo", "task", "list", "--size", "500", "--status", "false"]]);
});


test("ListTodos reports incomplete when the fetch limit is exhausted", async () => {
  const runDws = async () => ({
    success: true,
    data: {
      result: {
        todoList: [
          { id: "a", dueTime: "invalid" },
          { id: "b", dueTime: "2026-07-07T09:00:00+08:00" },
        ],
      },
    },
  });
  const handlers = createTodoHandlers({ runDws });

  const result = await handlers["dingtalk.todo.v1.TodoService/ListTodos"]({
    request: {
      isDone: true,
      startAt: "2026-07-06T00:00:00+08:00",
      endAt: "2026-07-13T00:00:00+08:00",
      fetchLimit: 2,
    },
  });

  assert.equal(result.complete, false);
  assert.equal(result.fetchedCount, 2);
  assert.equal(result.excludedWithoutDueAt, 1);
  assert.deepEqual(result.todos.map((item) => item.todoId), ["b"]);
});


test("ListTodos keeps the legacy unbounded list behavior", async () => {
  const calls = [];
  const runDws = async (_ctx, args) => {
    calls.push(args);
    return {
      success: true,
      data: { result: { todoList: [{ id: "a", subject: "no due" }] } },
    };
  };
  const handlers = createTodoHandlers({ runDws });

  const result = await handlers["dingtalk.todo.v1.TodoService/ListTodos"]({
    request: { isDone: false, limit: 10 },
  });

  assert.deepEqual(result.todos.map((item) => item.todoId), ["a"]);
  assert.equal(result.excludedWithoutDueAt, 0);
  assert.deepEqual(calls, [["todo", "task", "list", "--size", "10", "--status", "false"]]);
});


test("ListTodos binds the requested stable profile", async () => {
  const calls = [];
  const runDws = async (_ctx, args) => {
    calls.push(args);
    return { success: true, data: { result: { todoList: [] } } };
  };
  const handlers = createTodoHandlers({ runDws });

  await handlers["dingtalk.todo.v1.TodoService/ListTodos"]({
    request: { isDone: false, limit: 10, profile: "corp-a:user-a" },
  });

  assert.deepEqual(calls, [[
    "todo", "task", "list", "--size", "10", "--status", "false",
    "--profile", "corp-a:user-a",
  ]]);
});


test("ListTodos normalizes the current dws todoCards response", async () => {
  const runDws = async () => ({
    success: true,
    data: {
      result: {
        todoCards: [{
          taskId: "todo-current-1",
          subject: "机器人测试客户回访",
          isDone: false,
          dueTime: 1787056800000,
          createdTime: 1786970400000,
          priority: 30,
        }],
      },
    },
  });
  const handlers = createTodoHandlers({ runDws });

  const result = await handlers["dingtalk.todo.v1.TodoService/ListTodos"]({
    request: { isDone: false, fetchLimit: 50 },
  });

  assert.equal(result.success, true);
  assert.equal(result.fetchedCount, 1);
  assert.deepEqual(result.todos, [{
    todoId: "todo-current-1",
    title: "机器人测试客户回访",
    description: "",
    isDone: false,
    dueDate: "2026-08-18T12:40:00.000Z",
    createdAt: "1786970400000",
  }]);
});


test("CreateTodo and MarkDone preserve the installed package behavior", async () => {
  const calls = [];
  const runDws = async (_ctx, args) => {
    calls.push(args);
    if (args[2] === "create") {
      return { success: true, data: { result: [{ id: "todo-created" }] } };
    }
    if (args[2] === "list") {
      return {
        success: true,
        data: { result: { todoList: [{ id: "todo-created", subject: "客户回访" }] } },
      };
    }
    return { success: true, data: {} };
  };
  const handlers = createTodoHandlers({ runDws });

  const created = await handlers["dingtalk.todo.v1.TodoService/CreateTodo"]({
    request: {
      title: "客户回访",
      assigneeId: "cheng.shi",
      profile: "corp-a:user-a",
    },
  });
  const completed = await handlers["dingtalk.todo.v1.TodoService/MarkDone"]({
    request: { keyword: "回访" },
  });

  assert.equal(created.todoId, "todo-created");
  assert.equal(completed.matchedCount, 1);
  assert.deepEqual(calls.at(-1), [
    "todo", "task", "update", "--task-id", "todo-created", "--done", "true",
  ]);
});


function createHarness(responses = []) {
  const calls = [];
  const runDws = async (_ctx, args, options) => {
    calls.push({ args, options });
    return responses.shift() ?? { success: true, data: {} };
  };
  return { calls, handlers: createTodoHandlers({ runDws }) };
}


test("GetTodo maps stable identity and normalizes the task", async () => {
  const harness = createHarness([{
    success: true,
    data: {
      result: {
        id: "todo-17",
        subject: "机器人测试客户回访",
        done: false,
        dueTime: "2026-08-18T18:00:00+08:00",
        priority: 30,
      },
    },
  }]);

  const result = await harness.handlers[
    "dingtalk.todo.v1.TodoService/GetTodo"
  ]({ request: { todoId: "todo-17", profile: "corp-a:user-a" } });

  assert.deepEqual(result.todo, {
    todoId: "todo-17",
    title: "机器人测试客户回访",
    description: "",
    isDone: false,
    dueDate: "2026-08-18T18:00:00+08:00",
    createdAt: "",
    priority: 30,
  });
  assert.deepEqual(harness.calls, [{
    args: [
      "todo", "task", "get", "--task-id", "todo-17",
      "--profile", "corp-a:user-a",
    ],
    options: { write: false },
  }]);
});


test("GetTodo unwraps the current dws todoDetailModel response", async () => {
  const harness = createHarness([{
    success: true,
    data: {
      success: true,
      result: {
        todoDetailModel: {
          taskId: "todo-current-1",
          subject: "机器人测试客户回访",
          isDone: false,
          dueTime: 1787056800000,
          createdTime: 1786970400000,
          priority: 30,
        },
      },
    },
  }]);

  const result = await harness.handlers[
    "dingtalk.todo.v1.TodoService/GetTodo"
  ]({ request: { todoId: "todo-current-1", profile: "corp-a:user-a" } });

  assert.equal(result.success, true);
  assert.equal(result.todo.todoId, "todo-current-1");
  assert.equal(result.todo.title, "机器人测试客户回访");
  assert.equal(result.todo.dueDate, "2026-08-18T12:40:00.000Z");
  assert.equal(result.todo.priority, 30);
});

test("GetTodo normalizes a numeric-string dueTime to an absolute RFC3339 instant", async () => {
  const harness = createHarness([{
    success: true,
    data: {
      result: {
        todoDetailModel: {
          taskId: "todo-current-2",
          subject: "机器人测试客户回访",
          dueTime: "1787056800000",
        },
      },
    },
  }]);

  const result = await harness.handlers[
    "dingtalk.todo.v1.TodoService/GetTodo"
  ]({ request: { todoId: "todo-current-2", profile: "corp-a:user-a" } });

  assert.equal(result.todo.dueDate, "2026-08-18T12:40:00.000Z");
});


test("UpdateTodo maps only requested fields and writes exactly once", async () => {
  const harness = createHarness([{ success: true, data: { result: { id: "todo-17" } } }]);

  const result = await harness.handlers[
    "dingtalk.todo.v1.TodoService/UpdateTodo"
  ]({
    request: {
      todoId: "todo-17",
      profile: "corp-a:user-a",
      title: "机器人测试重点客户回访",
      priority: 40,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.todoId, "todo-17");
  assert.deepEqual(harness.calls, [{
    args: [
      "todo", "task", "update", "--task-id", "todo-17",
      "--title", "机器人测试重点客户回访",
      "--priority", "40",
      "--profile", "corp-a:user-a",
    ],
    options: { write: true },
  }]);
});


test("DeleteTodo rejects an unconfirmed request before DWS", async () => {
  const harness = createHarness();

  const result = await harness.handlers[
    "dingtalk.todo.v1.TodoService/DeleteTodo"
  ]({ request: { todoId: "todo-17", profile: "corp-a:user-a", confirmed: false } });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "CONFIRMATION_REQUIRED");
  assert.equal(result.outcomeUncertain, false);
  assert.equal(harness.calls.length, 0);
});


test("DeleteTodo uses the stable task ID and writes exactly once after confirmation", async () => {
  const harness = createHarness([{ success: true, data: { result: { id: "todo-17" } } }]);

  const result = await harness.handlers[
    "dingtalk.todo.v1.TodoService/DeleteTodo"
  ]({ request: { todoId: "todo-17", profile: "corp-a:user-a", confirmed: true } });

  assert.equal(result.success, true);
  assert.equal(result.todoId, "todo-17");
  assert.deepEqual(harness.calls, [{
    args: [
      "todo", "task", "delete", "--task-id", "todo-17",
      "--profile", "corp-a:user-a",
    ],
    options: { write: true, confirmed: true },
  }]);
});


test("todo mutations reject missing identity or patch before DWS", async () => {
  for (const [method, request] of [
    ["GetTodo", { todoId: "", profile: "corp-a:user-a" }],
    ["UpdateTodo", { todoId: "todo-17", profile: "corp-a:user-a" }],
    ["UpdateTodo", { todoId: "todo-17", profile: "", title: "新标题" }],
    ["DeleteTodo", { todoId: "todo-17", profile: "corp-a" }],
  ]) {
    const harness = createHarness();
    const result = await harness.handlers[
      `dingtalk.todo.v1.TodoService/${method}`
    ]({ request });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_ARGUMENT");
    assert.equal(harness.calls.length, 0);
  }
});


test("todo write transport uncertainty is returned without replay", async () => {
  for (const method of ["UpdateTodo", "DeleteTodo"]) {
    const harness = createHarness([{
      success: false,
      error: "DingTalk todo write result is uncertain",
      errorCode: "DWS_TIMEOUT",
      outcomeUncertain: true,
    }]);
    const request = {
      todoId: "todo-17",
      profile: "corp-a:user-a",
      ...(method === "UpdateTodo" ? { title: "新标题" } : {}),
      ...(method === "DeleteTodo" ? { confirmed: true } : {}),
    };

    const result = await harness.handlers[
      `dingtalk.todo.v1.TodoService/${method}`
    ]({ request });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "DWS_TIMEOUT");
    assert.equal(result.outcomeUncertain, true);
    assert.equal(harness.calls.length, 1);
  }
});
