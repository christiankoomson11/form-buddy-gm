import type { FormDefinition } from './types';
import { housingRepair } from './housing-repair';
import { councilTaxReduction } from './council-tax-reduction';

/* ---------------------------------------------------------------------------
   The form registry.

   Adding a form to the whole product is two lines: an import, and an entry
   below. Nothing else in the codebase changes.
   --------------------------------------------------------------------------- */

export const forms: FormDefinition[] = [housingRepair, councilTaxReduction];

export function getForm(id: string): FormDefinition | undefined {
  return forms.find((f) => f.id === id);
}

export function listForms() {
  return forms.map((f) => ({
    id: f.id,
    title: f.title,
    summary: f.summary,
    estimatedMinutes: f.estimatedMinutes,
    questionCount: f.questions.length,
  }));
}

export { isVisible, visibleQuestions } from './visibility';
export type { Answers } from './visibility';
export type { FormDefinition, Question } from './types';
