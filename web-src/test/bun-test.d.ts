declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(
    name: string,
    fn: (() => void) | (() => Promise<void>),
    timeoutMs?: number,
  ): void;
  export namespace test {
    function skip(name: string, fn: (() => void) | (() => Promise<void>)): void;
    function each<T>(
      cases: readonly T[],
    ): (
      name: string,
      fn: ((testCase: T) => void) | ((testCase: T) => Promise<void>),
    ) => void;
  }
  type Matchers = {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toMatch(pattern: string | RegExp): void;
    toHaveLength(expected: number): void;
  };
  export function expect(actual: unknown): Matchers & { not: Matchers };
}
