import test from "node:test";
import assert from "node:assert/strict";

import { createTodoHandlers } from "../src/todo.js";


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
    request: { title: "客户回访", assigneeId: "cheng.shi" },
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
