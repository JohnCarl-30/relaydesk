import { ARTICLES } from "@/lib/articles";
import { HelpIndex } from "./help-index";

export default function HelpIndexPage() {
  return <HelpIndex articles={ARTICLES} />;
}
