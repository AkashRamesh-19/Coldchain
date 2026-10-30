export type CatalogResource = "suppliers" | "products" | "warehouses" | "vehicles" | "drivers" | "routes";
export const catalogResources: Record<CatalogResource, { table: string; id: string; fields: readonly string[] }>;
export function isCatalogResource(value: string): value is CatalogResource;
export function validateCatalogBody(resource: CatalogResource, body: unknown, partial?: boolean): string | null;
