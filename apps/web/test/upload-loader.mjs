// Test-only resolve hook: replaces the browser-bound './client' module with a stub so upload.ts runs under `node --test`.
export async function resolve(specifier, context, next) {
  if (specifier === './client') return { url: new URL('./upload-client-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
