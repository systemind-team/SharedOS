[**SharedOS API v1.0.0-preview**](README.md)

---

[SharedOS API](README.md) / @aicoo/sharedos-os

# @aicoo/sharedos-os

Standard permission-controlled file tool adapters for SharedOS.

```bash
npm install @aicoo/sharedos-os
```

Hosts provide storage implementations; this package provides one canonical
`files` namespace, portable argument schemas, canonical resource paths, exact
per-call capability resolution, and tool definitions. Memory is represented by
files under host-defined paths, not by a second storage namespace.

The standard handlers also use `files` as their logical tool namespace and
`sharedos` as their catalog source. Hosts must explicitly include `files` in an
effective namespace selection before those handlers can be discovered.
Filesystem providers must still enforce root containment and reject symlink
escapes.

SharedOS is currently a `1.0.0` preview.

## Interfaces

### StandardOsProviders

Defined in: [index.ts:212](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L212)

#### Properties

| Property                             | Modifier   | Type                                                    | Defined in                                                                                         |
| ------------------------------------ | ---------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| <a id="property-files"></a> `files?` | `readonly` | [`ResourceProvider`](sharedos-core.md#resourceprovider) | [index.ts:213](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L213) |
| <a id="property-repo"></a> `repo?`   | `readonly` | [`ResourceProvider`](sharedos-core.md#resourceprovider) | [index.ts:214](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L214) |

## Type Aliases

### FilePath

> **FilePath** = `z.infer`\<_typeof_ [`FilePathSchema`](#filepathschema)>\>

Defined in: [index.ts:38](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L38)

---

### FilesAppendArguments

> **FilesAppendArguments** = `z.infer`\<_typeof_ [`FilesAppendArgumentsSchema`](#filesappendargumentsschema)>\>

Defined in: [index.ts:107](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L107)

---

### FilesCreateArguments

> **FilesCreateArguments** = `z.infer`\<_typeof_ [`FilesCreateArgumentsSchema`](#filescreateargumentsschema)>\>

Defined in: [index.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L71)

---

### FilesDeleteArguments

> **FilesDeleteArguments** = `z.infer`\<_typeof_ [`FilesDeleteArgumentsSchema`](#filesdeleteargumentsschema)>\>

Defined in: [index.ts:116](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L116)

---

### FilesGrepArguments

> **FilesGrepArguments** = `z.infer`\<_typeof_ [`FilesGrepArgumentsSchema`](#filesgrepargumentsschema)>\>

Defined in: [index.ts:62](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L62)

---

### FilesPathArguments

> **FilesPathArguments** = `z.infer`\<_typeof_ [`FilesPathArgumentsSchema`](#filespathargumentsschema)>\>

Defined in: [index.ts:41](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L41)

---

### FilesReplaceArguments

> **FilesReplaceArguments** = `z.infer`\<_typeof_ [`FilesReplaceArgumentsSchema`](#filesreplaceargumentsschema)>\>

Defined in: [index.ts:97](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L97)

---

### FilesSearchArguments

> **FilesSearchArguments** = `z.infer`\<_typeof_ [`FilesSearchArgumentsSchema`](#filessearchargumentsschema)>\>

Defined in: [index.ts:50](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L50)

---

### FilesSnapshotCreateArguments

> **FilesSnapshotCreateArguments** = `z.infer`\<_typeof_ [`FilesSnapshotCreateArgumentsSchema`](#filessnapshotcreateargumentsschema)>\>

Defined in: [index.ts:124](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L124)

---

### FilesSnapshotListArguments

> **FilesSnapshotListArguments** = `z.infer`\<_typeof_ [`FilesSnapshotListArgumentsSchema`](#filessnapshotlistargumentsschema)>\>

Defined in: [index.ts:132](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L132)

---

### FilesSnapshotRestoreArguments

> **FilesSnapshotRestoreArguments** = `z.infer`\<_typeof_ [`FilesSnapshotRestoreArgumentsSchema`](#filessnapshotrestoreargumentsschema)>\>

Defined in: [index.ts:141](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L141)

---

### RepoCommitArguments

> **RepoCommitArguments** = `z.infer`\<_typeof_ [`RepoCommitArgumentsSchema`](#repocommitargumentsschema)>\>

Defined in: [index.ts:200](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L200)

---

### RepoDiffArguments

> **RepoDiffArguments** = `z.infer`\<_typeof_ [`RepoDiffArgumentsSchema`](#repodiffargumentsschema)>\>

Defined in: [index.ts:182](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L182)

---

### RepoLogArguments

> **RepoLogArguments** = `z.infer`\<_typeof_ [`RepoLogArgumentsSchema`](#repologargumentsschema)>\>

Defined in: [index.ts:190](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L190)

---

### RepoPathspec

> **RepoPathspec** = `z.infer`\<_typeof_ [`RepoPathspecSchema`](#repopathspecschema)>\>

Defined in: [index.ts:154](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L154)

---

### RepoStageArguments

> **RepoStageArguments** = `z.infer`\<_typeof_ [`RepoStageArgumentsSchema`](#repostageargumentsschema)>\>

Defined in: [index.ts:195](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L195)

---

### RepoStatusArguments

> **RepoStatusArguments** = `z.infer`\<_typeof_ [`RepoStatusArgumentsSchema`](#repostatusargumentsschema)>\>

Defined in: [index.ts:173](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L173)

## Variables

### FilePathSchema

> `const` **FilePathSchema**: `ZodArray`\<`ZodString`, `"many"`>\>

Defined in: [index.ts:37](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L37)

---

### FILES\_NAMESPACE

> `const` **FILES\_NAMESPACE**: `"files"` = `"files"`

Defined in: [index.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L21)

The canonical SharedOS resource plane. Memory is a role of files, not a second store.

---

### FilesAppendArgumentsSchema

> `const` **FilesAppendArgumentsSchema**: `ZodObject`\<\{ `content`: `ZodType`\<[`JsonValue`](sharedos-contracts.md#jsonvalue), `ZodTypeDef`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `expectedVersion`: `ZodOptional`\<`ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>>\>\>; `metadata`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodType`\<[`JsonValue`](sharedos-contracts.md#jsonvalue), `ZodTypeDef`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>>>\>\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `content`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `expectedVersion?`: `string`; `metadata?`: `Record`\<`string`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `path`: `string`[]; \}, \{ `content`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `expectedVersion?`: `string`; `metadata?`: `Record`\<`string`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `path`: `string`[]; \}\>

Defined in: [index.ts:99](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L99)

---

### FilesCreateArgumentsSchema

> `const` **FilesCreateArgumentsSchema**: `ZodObject`\<\{ `content`: `ZodType`\<[`JsonValue`](sharedos-contracts.md#jsonvalue), `ZodTypeDef`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `metadata`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodType`\<[`JsonValue`](sharedos-contracts.md#jsonvalue), `ZodTypeDef`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>>>\>\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `content`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `metadata?`: `Record`\<`string`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `path`: `string`[]; \}, \{ `content`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `metadata?`: `Record`\<`string`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `path`: `string`[]; \}\>

Defined in: [index.ts:64](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L64)

---

### FilesDeleteArgumentsSchema

> `const` **FilesDeleteArgumentsSchema**: `ZodObject`\<\{ `expectedVersion`: `ZodOptional`\<`ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>>\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `recursive`: `ZodDefault`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `expectedVersion?`: `string`; `path`: `string`[]; `recursive`: `boolean`; \}, \{ `expectedVersion?`: `string`; `path`: `string`[]; `recursive?`: `boolean`; \}\>

Defined in: [index.ts:109](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L109)

---

### FilesGrepArgumentsSchema

> `const` **FilesGrepArgumentsSchema**: `ZodObject`\<\{ `caseSensitive`: `ZodDefault`\<`ZodBoolean`>\>; `contextAfter`: `ZodDefault`\<`ZodNumber`>\>; `contextBefore`: `ZodDefault`\<`ZodNumber`>\>; `mode`: `ZodDefault`\<`ZodEnum`\<\[`"literal"`, `"regex"`\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `pattern`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `caseSensitive`: `boolean`; `contextAfter`: `number`; `contextBefore`: `number`; `mode`: `"literal"` \| `"regex"`; `path`: `string`[]; `pattern`: `string`; \}, \{ `caseSensitive?`: `boolean`; `contextAfter?`: `number`; `contextBefore?`: `number`; `mode?`: `"literal"` \| `"regex"`; `path`: `string`[]; `pattern`: `string`; \}\>

Defined in: [index.ts:52](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L52)

---

### FilesPathArgumentsSchema

> `const` **FilesPathArgumentsSchema**: `ZodObject`\<\{ `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `path`: `string`[]; \}, \{ `path`: `string`[]; \}\>

Defined in: [index.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L40)

---

### FilesReplaceArgumentsSchema

> `const` **FilesReplaceArgumentsSchema**: `ZodObject`\<\{ `content`: `ZodType`\<[`JsonValue`](sharedos-contracts.md#jsonvalue), `ZodTypeDef`, [`JsonValue`](sharedos-contracts.md#jsonvalue)>\>; `expectedVersion`: `ZodOptional`\<`ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>>\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `content`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `expectedVersion?`: `string`; `path`: `string`[]; \}, \{ `content`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `expectedVersion?`: `string`; `path`: `string`[]; \}\>

Defined in: [index.ts:90](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L90)

---

### FilesSearchArgumentsSchema

> `const` **FilesSearchArgumentsSchema**: `ZodObject`\<\{ `limit`: `ZodOptional`\<`ZodNumber`>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `query`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `limit?`: `number`; `path`: `string`[]; `query`: `string`; \}, \{ `limit?`: `number`; `path`: `string`[]; `query`: `string`; \}\>

Defined in: [index.ts:43](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L43)

---

### FilesSnapshotCreateArgumentsSchema

> `const` **FilesSnapshotCreateArgumentsSchema**: `ZodObject`\<\{ `label`: `ZodOptional`\<`ZodString`>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `label?`: `string`; `path`: `string`[]; \}, \{ `label?`: `string`; `path`: `string`[]; \}\>

Defined in: [index.ts:118](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L118)

---

### FilesSnapshotListArgumentsSchema

> `const` **FilesSnapshotListArgumentsSchema**: `ZodObject`\<\{ `limit`: `ZodOptional`\<`ZodNumber`>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `limit?`: `number`; `path`: `string`[]; \}, \{ `limit?`: `number`; `path`: `string`[]; \}\>

Defined in: [index.ts:126](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L126)

---

### FilesSnapshotRestoreArgumentsSchema

> `const` **FilesSnapshotRestoreArgumentsSchema**: `ZodObject`\<\{ `expectedVersion`: `ZodOptional`\<`ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>>\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `snapshotId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `expectedVersion?`: `string`; `path`: `string`[]; `snapshotId`: `string`; \}, \{ `expectedVersion?`: `string`; `path`: `string`[]; `snapshotId`: `string`; \}\>

Defined in: [index.ts:134](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L134)

---

### REPO\_NAMESPACE

> `const` **REPO\_NAMESPACE**: `"repo"` = `"repo"`

Defined in: [index.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L34)

The Git resource plane.

`repo` and [FILES\_NAMESPACE](#files_namespace) may address the same directory and share
no authority: `capabilityMatches` compares `resource.namespace` before it
looks at anything else, so a file grant over a working tree matches nothing
here and a repository grant matches nothing there. Modelling `commit` as a
write under `files` would have made every holder of file-write authority a
committer, which is the permission cross-product ADR 0005 refuses. See
ADR 0024.

---

### RepoCommitArgumentsSchema

> `const` **RepoCommitArgumentsSchema**: `ZodObject`\<\{ `message`: `ZodEffects`\<`ZodString`, `string`, `string`>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `message`: `string`; `path`: `string`[]; \}, \{ `message`: `string`; `path`: `string`[]; \}\>

Defined in: [index.ts:197](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L197)

---

### RepoDiffArgumentsSchema

> `const` **RepoDiffArgumentsSchema**: `ZodObject`\<\{ `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `pathspec`: `ZodOptional`\<`ZodArray`\<`ZodArray`\<`ZodString`, `"many"`>\>, `"many"`>>\>\>; `staged`: `ZodDefault`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `path`: `string`[]; `pathspec?`: `string`[][]; `staged`: `boolean`; \}, \{ `path`: `string`[]; `pathspec?`: `string`[][]; `staged?`: `boolean`; \}\>

Defined in: [index.ts:175](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L175)

---

### RepoLogArgumentsSchema

> `const` **RepoLogArgumentsSchema**: `ZodObject`\<\{ `maxCount`: `ZodOptional`\<`ZodNumber`>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `maxCount?`: `number`; `path`: `string`[]; \}, \{ `maxCount?`: `number`; `path`: `string`[]; \}\>

Defined in: [index.ts:184](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L184)

---

### RepoPathspecSchema

> `const` **RepoPathspecSchema**: `ZodArray`\<`ZodArray`\<`ZodString`, `"many"`>\>, `"many"`>\>

Defined in: [index.ts:153](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L153)

Paths inside a repository, selecting what a diff or a stage covers.

Provider input, not a second resource: staging is authorized at the
repository, and the provider confines every entry beneath it exactly as
`validatePathArguments` does today. They are carried in the same canonical
segment vocabulary as any other path (ADR 0004), so a traversal marker is
refused before the provider is reached -- a vocabulary constraint, not the
authorization boundary. See ADR 0024.

---

### RepoStageArgumentsSchema

> `const` **RepoStageArgumentsSchema**: `ZodObject`\<\{ `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `pathspec`: `ZodArray`\<`ZodArray`\<`ZodString`, `"many"`>\>, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `path`: `string`[]; `pathspec`: `string`[][]; \}, \{ `path`: `string`[]; `pathspec`: `string`[][]; \}\>

Defined in: [index.ts:192](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L192)

---

### RepoStatusArgumentsSchema

> `const` **RepoStatusArgumentsSchema**: `ZodObject`\<\{ `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `path`: `string`[]; \}, \{ `path`: `string`[]; \}\>

Defined in: [index.ts:172](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L172)

---

### SHAREDOS\_TOOL\_SOURCE

> `const` **SHAREDOS\_TOOL\_SOURCE**: `"sharedos"` = `"sharedos"`

Defined in: [index.ts:35](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L35)

## Functions

### createFileTools()

> **createFileTools**(`provider`): readonly [`ToolHandler`](sharedos-core.md#toolhandler)[]

Defined in: [index.ts:240](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L240)

Portable file tools over one host-owned provider.

A host may expose roots such as Raw, Memory, Workspace, and Wiki, but they
remain paths in this one resource plane. Search indexes and context mounts
must preserve the same file grants; they are not independent authority.

#### Parameters

| Parameter  | Type                                                    |
| ---------- | ------------------------------------------------------- |
| `provider` | [`ResourceProvider`](sharedos-core.md#resourceprovider) |

#### Returns

readonly [`ToolHandler`](sharedos-core.md#toolhandler)[]

---

### createRepoTools()

> **createRepoTools**(`provider`): readonly [`ToolHandler`](sharedos-core.md#toolhandler)[]

Defined in: [index.ts:474](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L474)

The vetted Git subset over one host-owned provider, beside the file tools.

Five tools, one per subcommand the host's `safe-git` allows, each resolving
to an action of its own: a plane with a single `write` could not express "may
stage, never commit", which is the distinction hosts already make. `push`,
`reset`, `checkout`, `clean`, `config`, and `remote` are deliberately absent
and stay behind whatever authorizes an arbitrary shell command.

The capability names the repository; the provider confines every path
argument beneath it. SharedOS ships the vocabulary and the authorization and
never a Git implementation, so the execution hardening the host applies --
disabled hooks, no system or global config, no external diff or textconv
drivers, no clean filters, refused symlinks -- holds because the provider is
the only code that can turn a capability into an invocation, not because any
grant asked for it. See ADR 0024.

#### Parameters

| Parameter  | Type                                                    |
| ---------- | ------------------------------------------------------- |
| `provider` | [`ResourceProvider`](sharedos-core.md#resourceprovider) |

#### Returns

readonly [`ToolHandler`](sharedos-core.md#toolhandler)[]

---

### registerStandardOsTools()

> **registerStandardOsTools**(`kernel`, `providers`): `void`

Defined in: [index.ts:217](https://github.com/systemind-team/SharedOS/blob/main/packages/os/src/index.ts#L217)

#### Parameters

| Parameter   | Type                                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| `kernel`    | `Pick`\<[`SharedOSKernel`](sharedos-core.md#sharedoskernel), `"registerTool"`\> |
| `providers` | [`StandardOsProviders`](#standardosproviders)                                   |

#### Returns

`void`
