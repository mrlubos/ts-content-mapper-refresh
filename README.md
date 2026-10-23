# A content-mapped file changed on disk never refreshes diagnostics

TypeScript 7.1.0-beta. `index.ts` imports `./shape.data`, which `toy-mapper` turns into an interface, and `./dep.ts`. Both imports are read for a property, `age`, that neither declares yet.

```sh
npm install
npm run repro
```

```
1. dep.ts changed on disk, refresh requests: 1
2. shape.data changed on disk, refresh requests: 0
   errors when pulled by hand: []
3. shape.data edited while open, refresh requests: 1
```

`repro.mjs` drives `tsc --lsp` as VS Code does: pull diagnostics, with `workspace/diagnostic/refresh` support. It changes each file on disk and sends `workspace/didChangeWatchedFiles`, as the client does.

After a mapped file changes on disk, the server has the right diagnostics when asked, but it never asks the editor to pull them. So in VS Code, the error on `data.age` stays until `TypeScript: Restart TS Server`. The same change made in an open editor does refresh.

The refresh is gated by `isRelevantExtension` in `Session.DidChangeWatchedFiles`, added in microsoft/typescript-go#4604, which predates content mappers (microsoft/typescript-go#4712) and does not count the extensions a project's `contentMappers` register.

To see it in VS Code: open this folder, set `"js/ts.experimental.useTsgo": true`, `"js/ts.contentMappers.enabled": true` and `"js/ts.tsdk.path": "node_modules/typescript/lib"`, open `index.ts`, then add `age: number` to `shape.data` from a terminal, for example `echo 'age: number' >> shape.data`.
