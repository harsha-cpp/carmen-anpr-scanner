const CENTRAL_API_URL = process.env.CENTRAL_API_URL ?? "";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const HITLIST_ID = process.env.HITLIST_ID ?? "";
let hitlistPlates: Set<string> = new Set();

export async function refreshHitlistCache(): Promise<void> {
  if (!CENTRAL_API_URL || !DEVICE_TOKEN || !HITLIST_ID) return;
  try {
    const resp = await fetch(`${CENTRAL_API_URL}/api/sync/hitlists/${HITLIST_ID}`,
      { headers: { "x-device-token": DEVICE_TOKEN }, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return;
    const data = await resp.json() as { version?: { entries?: Array<{ plateNormalized: string }> } };
    const entries = data.version?.entries ?? [];
    hitlistPlates = new Set(entries.map((e) => e.plateNormalized));
  } catch {
    // network failure — keep using cached plates
  }
}

export function isInMainHitlist(plateNormalized: string): boolean {
  return hitlistPlates.has(plateNormalized);
}
