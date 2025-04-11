import type { GopConfig } from "./Vega6000StreamApi";

export function areSetsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const elem of a) {
    if (!b.has(elem)) {
      return false;
    }
  }
  return true;
}

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function notUndefinedOrNull<T>(x: T | undefined | null): x is T {
  return x !== undefined && x !== null;
}

export function parseJSVarsTextToJson(body: string): Record<string, string> {
  const lines = body.split("\n");

  const entries = lines
    .map((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        const [name, value] = trimmedLine.split("=");
        const cleanName = name.trim().replace("var ", "");
        const cleanValue = value.trim().replace(/"/g, "").replace(/;$/, "");
        return [cleanName, cleanValue];
      }
      return null;
    })
    .filter(notUndefinedOrNull);

  return Object.fromEntries(entries);
}

export const formatIframeInterval = (gop?: GopConfig): string | undefined => {
  if (!gop) return undefined;
  const { bFrames, gopLength, idrInterval } = gop;
  return `${bFrames},${gopLength},${idrInterval}`;
};

export function fillPattern(pattern: string, values: any[]): string {
  function checkPattern() {
    const vars = pattern.match(/\$[0-9]+/g) || [];
    const count = vars.length;
    const expectedVars = new Set(
      new Array(count).fill(0).map((_, i) => `$${i + 1}`)
    );

    if (!areSetsEqual(new Set(vars), expectedVars)) {
      throw new Error(`Invalid pattern: ${pattern}`);
    }
    if (count !== values.length) {
      throw new Error(
        `Number of values (${values.length}) does not match number of placeholders (${count})`
      );
    }
  }

  checkPattern();

  return values.reduce((result, value, index) => {
    return result.replace(`$${index + 1}`, value.toString());
  }, pattern);
}
