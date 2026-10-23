import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/AuthCard";
import { SignUpForm } from "./signup-form";

export const metadata = { title: "Sign up · Relaydesk" };

export default async function SignUpPage() {
  // Read the sign-up code setting per request, not once at build time.
  await connection();
  return (
    <AuthCard
      title="Put your help center online"
      intro="Your customers get answers from your own articles, and anything it can't answer lands in your inbox."
    >
      <SignUpForm needsCode={Boolean(process.env.RELAYDESK_SIGNUP_CODE)} />
      <p className="mt-6 text-center text-sm text-muted">
        Already have a login?{" "}
        <Link href="/login" className="text-forest underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
