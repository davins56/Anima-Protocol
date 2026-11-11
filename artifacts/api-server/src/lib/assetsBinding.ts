// Shared holder for the Workers static-assets binding (wrangler `assets.binding`
// = "ASSETS"). worker.ts sets it per request, like aiBinding, so Express code can
// read bundled files (e.g. /seed-avatars/*.jpg) without fetching its own domain.

export type AssetsBinding = {
  fetch: (request: Request) => Promise<Response>;
};

export let assetsBinding: AssetsBinding | undefined;

export function setAssetsBinding(value: AssetsBinding | undefined) {
  assetsBinding = value;
}
