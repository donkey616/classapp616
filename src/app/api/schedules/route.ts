import "server-only";
import { requireIdentity } from "../../../../cursor/identity";
import { getSharedSchedules } from "../../../lib/mtr-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const QUIET = { "cache-control": "private, no-store" };

export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    const snapshot = await getSharedSchedules(identity.stage);
    if (!snapshot) {
      return Response.json({ error: "港鐵到站服務暫時忙碌，請稍後再試。" }, { status: 503, headers: QUIET });
    }
    return Response.json(snapshot, { headers: QUIET });
  } catch {
    return Response.json({ error: "暫時無法讀取到站班次。" }, { status: 503, headers: QUIET });
  }
}
