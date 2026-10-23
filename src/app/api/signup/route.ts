import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Email, Password, PersonName, readBody } from "@/lib/api";
import { slugify } from "@/lib/article-import";
import { cameOverHttps, startSession } from "@/lib/auth";
import { BUSINESS_ID_PATTERN, getBusiness, getStaffByEmail, signUpBusiness } from "@/lib/db";

const SignUp = z.object({
  businessName: z.string().trim().min(2, "business name is required").max(80),
  /** The business's id in links; made from the name when left out. */
  businessId: z.string().trim().toLowerCase().optional(),
  name: PersonName,
  email: Email,
  password: Password,
  code: z.string().optional(),
});

// Paths a business id would shadow or be confused with.
const RESERVED = new Set(["api", "admin", "embed", "help", "inbox", "login", "signup", "invite", "nimbus", "relaydesk"]);

/** With RELAYDESK_SIGNUP_CODE set, only people given the code can sign up. */
function codeAccepted(code: string | undefined): boolean {
  const expected = process.env.RELAYDESK_SIGNUP_CODE;
  if (!expected) return true;
  const a = Buffer.from(code ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = await readBody(request, SignUp);
  if ("error" in body) return body.error;
  const input = body.data;
  if (!codeAccepted(input.code)) {
    return NextResponse.json({ error: "That sign-up code is wrong." }, { status: 403 });
  }

  const businessId = input.businessId || slugify(input.businessName).slice(0, 40).replace(/-+$/, "");
  if (!BUSINESS_ID_PATTERN.test(businessId) || RESERVED.has(businessId)) {
    return NextResponse.json(
      { error: "Pick a different link: 2 to 40 lowercase letters, digits, and dashes." },
      { status: 400 },
    );
  }
  if (getBusiness(businessId)) {
    return NextResponse.json({ error: `The link "${businessId}" is taken.` }, { status: 409 });
  }
  if (getStaffByEmail(input.email)) {
    return NextResponse.json(
      { error: "That email already has a login. Sign in instead." },
      { status: 409 },
    );
  }

  const staff = signUpBusiness({
    businessId,
    businessName: input.businessName,
    name: input.name,
    email: input.email,
    password: input.password,
  });
  await startSession(staff, { secure: cameOverHttps(request) });
  return NextResponse.json({ businessId });
}
