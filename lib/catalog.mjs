export const catalogResources = {
  suppliers: { table: "suppliers", id: "supplier_id", fields: ["supplier_name", "contact_person", "phone", "email", "address"] },
  products: { table: "products", id: "product_id", fields: ["supplier_id", "product_name", "category", "description", "min_temperature", "max_temperature", "min_humidity", "max_humidity"] },
  warehouses: { table: "warehouses", id: "warehouse_id", fields: ["warehouse_name", "location", "city", "state", "contact_number"] },
  vehicles: { table: "vehicles", id: "vehicle_id", fields: ["vehicle_number", "vehicle_type", "capacity_kg", "refrigeration_type", "status"] },
  drivers: { table: "drivers", id: "driver_id", fields: ["full_name", "phone", "license_number", "license_expiry", "status"] },
  routes: { table: "routes", id: "route_id", fields: ["route_name", "source_warehouse_id", "destination_warehouse_id", "distance_km", "estimated_duration_hours"] },
};

const requiredFields = {
  suppliers: ["supplier_name"],
  products: ["supplier_id", "product_name", "category", "min_temperature", "max_temperature"],
  warehouses: ["warehouse_name", "location", "city"],
  vehicles: ["vehicle_number", "vehicle_type", "capacity_kg"],
  drivers: ["full_name", "phone", "license_number", "license_expiry"],
  routes: ["route_name", "source_warehouse_id", "destination_warehouse_id", "distance_km", "estimated_duration_hours"],
};

const numberFields = new Set([
  "supplier_id", "source_warehouse_id", "destination_warehouse_id", "capacity_kg",
  "min_temperature", "max_temperature", "min_humidity", "max_humidity", "distance_km",
  "estimated_duration_hours",
]);

export function isCatalogResource(value) {
  return Object.hasOwn(catalogResources, value);
}

export function validateCatalogBody(resource, body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Request body must be a JSON object";
  const record = body;
  const definition = catalogResources[resource];
  const unsupported = Object.keys(record).filter((key) => !definition.fields.includes(key));
  if (unsupported.length) return `Unsupported fields: ${unsupported.join(", ")}`;
  if (!partial) {
    const missing = requiredFields[resource].filter((field) => record[field] === undefined || record[field] === null);
    if (missing.length) return `Missing required fields: ${missing.join(", ")}`;
  } else if (Object.keys(record).length === 0) return "At least one field is required";

  for (const [field, value] of Object.entries(record)) {
    if (value === null && ["min_humidity", "max_humidity", "description", "contact_person", "phone", "email", "address", "state", "contact_number", "refrigeration_type"].includes(field)) continue;
    if (numberFields.has(field)) {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${field} must be a finite number`;
      if (field.endsWith("_id") && (!Number.isInteger(value) || value <= 0)) return `${field} must be a positive integer`;
    } else if (field === "status") {
      const allowed = resource === "vehicles" ? ["AVAILABLE", "IN_TRANSIT", "MAINTENANCE"] : ["AVAILABLE", "ON_DUTY", "INACTIVE"];
      if (typeof value !== "string" || !allowed.includes(value)) return `Invalid ${field}`;
    } else if (typeof value !== "string" || value.length > 255 || (!value.trim() && requiredFields[resource].includes(field))) {
      return `${field} must be a non-empty string of at most 255 characters`;
    }
    if (field === "email" && typeof value === "string" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email must be valid";
    if (field === "license_expiry" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) return "license_expiry must use YYYY-MM-DD";
  }

  if (typeof record.min_temperature === "number" && typeof record.max_temperature === "number" && record.min_temperature >= record.max_temperature) return "min_temperature must be below max_temperature";
  if (typeof record.min_humidity === "number" && typeof record.max_humidity === "number" && record.min_humidity >= record.max_humidity) return "min_humidity must be below max_humidity";
  if (typeof record.min_humidity === "number" && (record.min_humidity < 0 || record.min_humidity > 100)) return "min_humidity must be between 0 and 100";
  if (typeof record.max_humidity === "number" && (record.max_humidity < 0 || record.max_humidity > 100)) return "max_humidity must be between 0 and 100";
  if (typeof record.distance_km === "number" && record.distance_km <= 0) return "distance_km must be positive";
  if (typeof record.estimated_duration_hours === "number" && record.estimated_duration_hours <= 0) return "estimated_duration_hours must be positive";
  if (typeof record.capacity_kg === "number" && record.capacity_kg <= 0) return "capacity_kg must be positive";
  if (typeof record.source_warehouse_id === "number" && record.source_warehouse_id === record.destination_warehouse_id) return "A route must use different warehouses";
  return null;
}
