export function redirect(url: string): never {
  throw new Error(`redirect:${url}`);
}
export function notFound(): never {
  throw new Error("not_found");
}
