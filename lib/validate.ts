/* ---------------------------------------------------------------------------
   The validation engine
   ---------------------------------------------------------------------------

   Interprets the data rules declared on each question. Two principles:

   1. NOTHING HERE DECIDES ELIGIBILITY. These rules catch typos, missing
      postcodes and dates in the future. Whether someone qualifies for a
      reduction or an urgent repair is the council's decision, made by a
      person. The brief is explicit about keeping a human in the loop, and
      this is where it would be easiest to get that wrong.

   2. ERRORS BLOCK, WARNINGS DO NOT. If someone insists their answer is
      right, they are probably right — they know their own circumstances.
      A tool that refuses to move on is a locked door, which is the exact
      problem we are trying to remove.

   This runs with no AI and no network. The AI explains and rewords; the
   rules decide. That split matters: it means a council officer can audit
   every check the tool makes, and the checks behave identically every time.
   --------------------------------------------------------------------------- */

import type {
  FormDefinition,
  Question,
  ValidationRule,
} from './forms/types';
import type { Answers } from './forms/visibility';

export type Issue = {
  questionId: string;
  message: string;
  /** 'error' must be fixed. 'warning' can be overridden by the resident. */
  severity: 'error' | 'warning';
};

/* --- Postcode -------------------------------------------------------------
   Deliberately loose. A strict UK postcode regex rejects valid edge cases and
   newly issued codes, and the cost of a false rejection here is a resident
   stuck on a form, which is far worse than a postcode we failed to spot.
   We only check that something postcode-shaped is present.
   ------------------------------------------------------------------------ */

const POSTCODE_SHAPE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

export function looksLikePostcode(text: string): boolean {
  return POSTCODE_SHAPE.test(text);
}

/* --- Single rule --------------------------------------------------------- */

function applyRule(rule: ValidationRule, value: string): string | null {
  const trimmed = value.trim();

  switch (rule.kind) {
    case 'minLength':
      return trimmed.length < rule.value ? rule.message : null;

    case 'maxLength':
      return trimmed.length > rule.value ? rule.message : null;

    case 'pattern':
      return new RegExp(rule.value).test(trimmed) ? null : rule.message;

    case 'postcode':
      return looksLikePostcode(trimmed) ? null : rule.message;

    case 'notFuture': {
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime())) return null; // not a date; let other rules speak
      // Compare date-only, so "today" never trips the check in any timezone.
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return date > today ? rule.message : null;
    }

    case 'notBefore': {
      const date = new Date(trimmed);
      const floor = new Date(rule.value);
      if (Number.isNaN(date.getTime()) || Number.isNaN(floor.getTime())) {
        return null;
      }
      return date < floor ? rule.message : null;
    }

    case 'min': {
      const n = Number(trimmed);
      return Number.isFinite(n) && n < rule.value ? rule.message : null;
    }

    case 'max': {
      const n = Number(trimmed);
      return Number.isFinite(n) && n > rule.value ? rule.message : null;
    }

    default: {
      // Exhaustiveness guard: adding a rule kind without handling it here
      // becomes a compile error rather than a rule that silently never fires.
      const _never: never = rule;
      void _never;
      return null;
    }
  }
}

/* --- One question -------------------------------------------------------- */

/**
 * Validate a single answer. Used as the resident moves between questions,
 * so they find out about a problem while the answer is still in front of
 * them rather than at the end.
 */
export function validateAnswer(
  question: Question,
  rawValue: string | undefined,
): Issue[] {
  const value = (rawValue ?? '').trim();

  if (!value) {
    if (question.required) {
      return [
        {
          questionId: question.id,
          message: 'We need an answer to this one to carry on.',
          severity: 'error',
        },
      ];
    }
    // Not required and left blank — nothing to check.
    return [];
  }

  // A choice must be one of the offered options. If it is not, something is
  // wrong with our data or someone is poking at the API.
  if (question.type === 'choice' && question.options) {
    const valid = question.options.some((o) => o.value === value);
    if (!valid) {
      return [
        {
          questionId: question.id,
          message: 'Please pick one of the options shown.',
          severity: 'error',
        },
      ];
    }
    return [];
  }

  const issues: Issue[] = [];

  for (const rule of question.validation ?? []) {
    const message = applyRule(rule, value);
    if (message) {
      issues.push({
        questionId: question.id,
        message,
        /*
         * A missing postcode is a warning, not an error. Some addresses
         * genuinely do not have one the resident knows, and blocking them
         * would be the locked door again. Everything else that fails a
         * declared rule is an error.
         */
        severity: rule.kind === 'postcode' ? 'warning' : 'error',
      });
    }
  }

  return issues;
}

/* --- Whole form ---------------------------------------------------------- */

/**
 * Run every per-question rule plus the cross-question consistency checks.
 * Called when the resident reaches the summary.
 */
export function validateForm(
  form: FormDefinition,
  answers: Answers,
  /** Pass the visible questions so skipped ones are not marked incomplete. */
  applicable: Question[],
): Issue[] {
  const issues: Issue[] = [];

  for (const question of applicable) {
    issues.push(...validateAnswer(question, answers[question.id]));
  }

  for (const check of form.checks ?? []) {
    const answered = check.needs.every((id) => (answers[id] ?? '').trim());
    if (!answered) continue;

    if (check.kind === 'advisory') {
      issues.push({
        questionId: check.needs[0],
        message: check.message,
        severity: 'warning',
      });
      continue;
    }

    if (check.kind === 'dateOrder' && check.before && check.after) {
      const before = new Date(answers[check.before]);
      const after = new Date(answers[check.after]);
      if (
        !Number.isNaN(before.getTime()) &&
        !Number.isNaN(after.getTime()) &&
        before > after
      ) {
        issues.push({
          questionId: check.after,
          message: check.message,
          severity: 'warning',
        });
      }
      continue;
    }

    if (check.kind === 'choiceRequiresText' && check.when && check.requires) {
      const triggered = answers[check.when.question] === check.when.equals;
      if (triggered) {
        issues.push({
          questionId: check.requires,
          message: check.message,
          severity: 'warning',
        });
      }
    }
  }

  return issues;
}

/** Are there any blocking problems? Warnings do not block. */
export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
