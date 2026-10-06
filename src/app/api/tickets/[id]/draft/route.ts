import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { runCopilot } from "@/lib/copilot";

/** Regenerate: run the co-pilot on this ticket now. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const result = await runCopilot(id, "regenerate");
  return NextResponse.json(result);
}
