/*
 * The widget's voice channel. The browser turns speech into text, the text goes
 * through the same answer loop as typed messages, and the reply is read aloud.
 * Plain functions with no server imports, so the widget can use them too.
 */

/** Where a visitor's message came from. Voice messages are tagged on the answer span. */
export type Channel = "text" | "voice";

export function parseChannel(value: unknown): Channel {
  return value === "voice" ? "voice" : "text";
}

/** About 30 seconds of speech. Longer answers stay in the chat, and the voice says so. */
export const SPOKEN_LIMIT = 450;

const MORE_IN_CHAT = "The rest is in the chat.";

/**
 * A reply as it should sound: no links, markdown or ticket ids read out
 * character by character, and short enough to listen to.
 */
export function spokenText(reply: string, limit = SPOKEN_LIMIT): string {
  const text = reply
    // A ticket id read aloud is noise; the chat shows it.
    .replace(/Ticket \S+ is in the staff inbox\./gi, "I've passed this to the team.")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link in the chat")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;

  // Cut at the last full sentence that fits, so speech never stops mid-word.
  const room = limit - MORE_IN_CHAT.length - 1;
  const head = text.slice(0, room);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  const cut = end > room / 3 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(" "))}…`;
  return `${cut} ${MORE_IN_CHAT}`;
}

/** What to tell the visitor when the browser's speech recognition stops with an error. */
export function recognitionErrorMessage(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser, or type your question.";
    case "no-speech":
      return "I didn't catch that. Tap the mic and try again.";
    case "audio-capture":
      return "No microphone found. Type your question instead.";
    case "network":
      return "Voice needs a connection. Type your question instead.";
    case "aborted":
      // The visitor stopped it, or the widget closed.
      return null;
    default:
      return "Voice input stopped. Type your question or try again.";
  }
}
