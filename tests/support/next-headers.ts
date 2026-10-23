export async function cookies() {
  return { get: () => undefined, set: () => undefined, delete: () => undefined };
}
export async function headers() {
  return new Headers();
}
