# DingTalk Todo

OctoBus service for DingTalk todo list, create, detail, completion, update, and delete operations.

The stable mutation methods are `GetTodo`, `UpdateTodo`, and `DeleteTodo`. They require an explicit todo ID and `corpId:userId` profile. `ListTodos` also accepts the same profile so object resolution and the final mutation use one account.

Update and delete execute the corresponding DWS command once. Transport timeout or disconnect is returned as an uncertain outcome and is never replayed by this service.

`DeleteTodo` requires `confirmed=true`. Existing callers that omit the field receive `CONFIRMATION_REQUIRED` and perform no DWS call; only confirmed deletion passes `--yes` to DWS.
