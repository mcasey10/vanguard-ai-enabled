/**
 * Detects a malformed multi-paragraph narration response — the "prompt
 * instruction alone is not a guarantee" principle this project already
 * applies to Feature 2 (whatIfValidation.ts's validateCandidate()/
 * validateSummary(), D052/D053), applied here for the first time to
 * Feature 1. narrationPrompt.ts now explicitly instructs a single,
 * final-answer-only response — but a real live call (found while
 * investigating Segment C's example-anchoring bug, D123) returned a
 * response whose text contained two paragraphs: a long draft that violated
 * essentially every rule for its segment, immediately followed by a short,
 * fully compliant sentence. Nothing checked the shape of that response
 * before it would have reached a user. See DECISIONS.md's leaked-draft
 * entry for the full investigation.
 *
 * Every real narration response this app ever asks for is continuous
 * prose — none of the four segments' instructions, at any touchpoint, ever
 * ask for a paragraph break, and the shared "Output prose only" instruction
 * already implies one continuous block. A response split by a blank line
 * into 2+ non-empty blocks is therefore never a legitimate multi-paragraph
 * answer; it's evidence of a leaked draft, an accidental self-correction,
 * or some other malformation this app has no reliable way to interpret.
 * Fail closed rather than guess which block is the real one — a naive
 * "keep the last paragraph" repair would have worked on the one real case
 * observed so far, but nothing guarantees the real answer is always last,
 * and CD-1.2's own honesty standard is better served by treating a
 * malformed response as a generation failure (falls back to the
 * deterministic summary, exactly the existing path for a provider error)
 * than by gambling on a best-effort truncation.
 */
export function isMalformedNarrationText(raw: string): boolean {
  const blocks = raw
    .trim()
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0)
  return blocks.length > 1
}
