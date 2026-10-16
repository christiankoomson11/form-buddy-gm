/* ---------------------------------------------------------------------------
   Which questions currently apply.

   Kept separate from the registry in index.ts because these are pure
   functions over data: no imports beyond types, so they are trivially
   testable and can run anywhere — the browser, a route handler, a test.
   --------------------------------------------------------------------------- */

import type { FormDefinition, Question } from './types';

export type Answers = Record<string, string>;

/**
 * Is this question relevant, given what has been answered so far?
 *
 * Skipping irrelevant questions is not a nicety. A form that asks everyone
 * everything is the single biggest cause of people giving up partway
 * through, which is the problem this whole tool exists to fix.
 */
export function isVisible(question: Question, answers: Answers): boolean {
  if (!question.showWhen) return true;
  return answers[question.showWhen.question] === question.showWhen.equals;
}

/** The questions that currently apply, in order. */
export function visibleQuestions(
  form: FormDefinition,
  answers: Answers,
): Question[] {
  return form.questions.filter((q) => isVisible(q, answers));
}
