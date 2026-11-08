import { JsonObjectSchema } from "@aicoo/sharedos-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { after, parseJsonObject, readJsonObject } from "./internal.js";

class Plain {
  readonly own = 1;
}

/** Every own name at every depth, so a dropped or an added key is seen, not just a changed value. */
function shape(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const entries = Object.getOwnPropertyNames(value).map((key) => [
    key,
    shape((value as Record<string, unknown>)[key]),
  ]);
  return { proto: Object.getPrototypeOf(value)?.constructor?.name ?? null, entries };
}

describe("readJsonObject", () => {
  const inherited = Object.create({ inherited: "yes" }) as Record<string, unknown>;
  inherited["own"] = 1;
  const hidden = Object.defineProperty({ shown: 1 }, "hidden", { value: 2, enumerable: false });
  const getter = Object.defineProperty({}, "computed", { get: () => "read", enumerable: true });
  const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
  const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const values: readonly [string, unknown][] = [
    ["plain", { path: ["Workspace"], n: 1, ok: true, none: null }],
    ["nested", { a: { b: [1, { c: [[]] }] }, d: {} }],
    ["negative zero and the largest double", { z: -0, big: 1.5e308 }],
    ["infinity", { n: Number.POSITIVE_INFINITY }],
    ["negative infinity nested", { a: [{ n: Number.NEGATIVE_INFINITY }] }],
    ["nan", { n: Number.NaN }],
    ["undefined value", { a: undefined }],
    ["undefined value nested", { a: { b: undefined } }],
    ["bigint", { n: 1n }],
    ["symbol value", { s: Symbol("s") }],
    ["function value", { f: () => 1 }],
    ["date", { at: new Date(0) }],
    ["map", { m: new Map() }],
    ["set", { s: new Set() }],
    ["promise", { p: Promise.resolve(1) }],
    ["thenable with catch", { p: { then: () => 1, catch: () => 1 } }],
    ["then without catch, as a record of a function", { p: { then: () => 1 } }],
    ["then and catch that are not functions", { p: { then: 1, catch: 2 } }],
    ["class instance", { o: new Plain() }],
    ["inherited enumerable key", { o: inherited }],
    ["null prototype", { o: nullProto }],
    ["non-enumerable own key", { o: hidden }],
    ["enumerable getter", { o: getter }],
    ["string object", { o: new String("xy") }],
    ["number object", { o: new Number(5) }],
    ["regexp", { o: /x/u }],
    ["error", { o: new Error("x") }],
    ["typed array", { o: new Uint8Array([1, 2]) }],
    ["sparse array", { a: sparse }],
    ["array with undefined", { a: [1, undefined] }],
    ["frozen", Object.freeze({ a: Object.freeze([1]) })],
    ["__proto__ own key at the top", JSON.parse('{"__proto__":{"x":1},"y":2}') as unknown],
    [
      "__proto__ own key nested",
      JSON.parse('{"a":{"__proto__":1,"b":[{"__proto__":2,"c":3}]}}') as unknown,
    ],
    ["__proto__ own key with a refused value", JSON.parse('{"__proto__":1e999}') as unknown],
    ["prototype-ish names as ordinary keys", { constructor: 1, toString: 2, hasOwnProperty: 3 }],
    ["integer-like keys", { "1": "x", b: "y", "0": "z" }],
    ["empty key", { "": "" }],
    ["deep", { deep: JSON.parse(`${"[".repeat(64)}1${"]".repeat(64)}`) as unknown }],
    ["top-level null", null],
    ["top-level array", [1, 2]],
    ["top-level string", "a string"],
    ["top-level number", 1],
    ["top-level undefined", undefined],
    ["top-level date", new Date(0)],
    ["top-level map", new Map()],
    ["top-level promise", Promise.resolve({})],
    ["top-level class instance", new Plain()],
    ["top-level string object", new String("xy")],
    ["top-level typed array", new Uint8Array([1])],
  ];

  it.each(values)("gives the verdict and the value JsonObjectSchema gives: %s", (_label, value) => {
    const expected = JsonObjectSchema.safeParse(value);
    const actual = readJsonObject(value);
    expect(actual === undefined).toBe(!expected.success);
    if (expected.success) {
      expect(actual).toEqual(expected.data);
      expect(shape(actual)).toEqual(shape(expected.data));
    }
  });

  it("hands back a copy, never the parser's own containers", () => {
    const inner = [1];
    const value = { a: inner, b: { c: 1 } };
    const read = readJsonObject(value);
    expect(read).toEqual(value);
    expect(read).not.toBe(value);
    expect(read?.["a"]).not.toBe(inner);
    expect(read?.["b"]).not.toBe(value.b);
  });
});

describe("parseJsonObject", () => {
  const texts: readonly [string, string][] = [
    ["plain", '{"path":["Workspace"],"n":1,"ok":true,"none":null}'],
    ["nested", '{"a":{"b":[1,{"c":[[]]}]},"d":{}}'],
    ["negative zero and the largest double", '{"z":-0,"big":1.5e308}'],
    ["overflowing literal", '{"n":1e999}'],
    ["overflowing literal nested", '{"a":[{"n":-1e999}]}'],
    ["__proto__ own key at the top", '{"__proto__":{"x":1},"y":2}'],
    ["__proto__ own key nested", '{"a":{"__proto__":1,"b":[{"__proto__":2,"c":3}]}}'],
    ["__proto__ own key with a refused value", '{"__proto__":1e999}'],
    ["prototype-ish names as ordinary keys", '{"constructor":1,"toString":2}'],
    ["integer-like keys", '{"1":"x","b":"y","0":"z"}'],
    ["empty key", '{"":""}'],
    ["duplicate key, last wins", '{"a":1,"a":2}'],
    ["deep", `{"deep":${"[".repeat(64)}1${"]".repeat(64)}}`],
    ["empty object", "{}"],
  ];

  it.each(texts)("gives the verdict and the value JsonObjectSchema gives: %s", (_label, text) => {
    const expected = JsonObjectSchema.safeParse(JSON.parse(text));
    const actual = parseJsonObject(text);
    expect(actual === undefined).toBe(!expected.success);
    if (expected.success) {
      expect(actual).toEqual(expected.data);
      expect(shape(actual)).toEqual(shape(expected.data));
    }
  });

  it.each([
    ["not JSON", "{"],
    ["empty text", ""],
    ["a top-level array", "[1]"],
    ["a top-level string", '"x"'],
    ["a top-level null", "null"],
  ])("refuses %s", (_label, text) => {
    expect(parseJsonObject(text)).toBeUndefined();
  });

  it("hands the parsed containers back untouched when nothing had to be dropped", () => {
    const text = '{"a":[1,{"b":2}],"c":{"d":[]}}';
    const read = parseJsonObject(text);
    expect(read).toEqual(JSON.parse(text));
    expect(Object.isFrozen(read)).toBe(false);
  });

  it("copies only the containers on the path to a dropped key", () => {
    const read = parseJsonObject('{"kept":{"x":1},"changed":{"__proto__":{},"y":2}}');
    expect(read).toEqual({ kept: { x: 1 }, changed: { y: 2 } });
    expect(Object.getOwnPropertyNames(read?.["changed"])).toEqual(["y"]);
  });
});

describe("after", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("waits out a delay longer than one timer can hold instead of firing early", async () => {
    const fired = vi.fn();
    const ceiling = 2_147_483_647;
    const cancel = after(ceiling + 1_000, fired);

    await vi.advanceTimersByTimeAsync(ceiling);
    expect(fired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(fired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toHaveBeenCalledOnce();
    cancel();
  });

  it("is cancelled part-way through a long wait", async () => {
    const fired = vi.fn();
    const cancel = after(2_147_483_647 * 2, fired);

    await vi.advanceTimersByTimeAsync(2_147_483_647 + 10);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(fired).not.toHaveBeenCalled();
  });

  it("leaves every step of the wait unable to hold the process open when asked to", async () => {
    const armed = vi.spyOn(globalThis, "setTimeout");
    const timers = (): NodeJS.Timeout[] =>
      armed.mock.results.map((result) => result.value as NodeJS.Timeout);

    const held = after(10, vi.fn());
    expect(timers().map((timer) => timer.hasRef())).toEqual([true]);
    held();
    armed.mockClear();

    const cancel = after(2_147_483_647 + 1_000, vi.fn(), { unref: true });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(timers().map((timer) => timer.hasRef())).toEqual([false, false]);
    cancel();
  });
});
