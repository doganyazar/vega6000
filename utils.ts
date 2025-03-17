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
