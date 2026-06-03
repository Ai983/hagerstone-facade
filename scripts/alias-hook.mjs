// Node module-resolution hook so the verify scripts can import the real app
// modules that use the "@/..." Vite alias. Maps @/x -> <repo>/src/x(.ts).
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = pathToFileURL(path.resolve("src") + path.sep).href;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    let target = SRC + specifier.slice(2);
    if (!/\.[a-zA-Z]+$/.test(target)) target += ".ts";
    return next(target, context);
  }
  return next(specifier, context);
}
