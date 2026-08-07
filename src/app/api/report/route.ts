import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { reportKey, REPORT_TTL_SECONDS } from "@/lib/occupancy";

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Occupancy reporting isn't configured on this deployment." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const spotId = (body as Record<string, unknown>)?.spotId;

  if (typeof spotId !== "string" || !spotId) {
    return NextResponse.json({ error: "Body must be { spotId: string }" }, { status: 400 });
  }

  const reportedAt = Date.now();
  await redis.set(reportKey(spotId), { reportedAt }, { ex: REPORT_TTL_SECONDS });

  return NextResponse.json({ reportedAt });
}
